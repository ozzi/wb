// Version: 3
// Регулирование насоса ТП по ΔT (подача − обратка) на штатном ПИД-движке Wiren Board.
//
// Движок: require('pid-engine.mod').PidEngine (пакет wb-scenarios) —
// P по ошибке, I с anti-windup (0..100), D по измерению с ФНЧ, мёртвая зона
// как снижение усиления до 10 %.
//
// Задача: держать заданную ΔT контура. Связь обратная — чем больше расход,
// тем меньше ΔT, поэтому штатный движок считает ошибку как «уставка − факт»
// и его выход 0..100 % означает степень ДРОССЕЛИРОВАНИЯ: 0 % = максимум
// оборотов, 100 % = минимум.
//
// v3: наружу выведена мощность насоса, а не дросселирование. Канал `output`
// теперь читается как «скорость насоса, %»: output 59 % = power 590 (середина
// шкалы), и power = output × 10 без инверсии. Внутри движка интеграл остаётся
// в прежней конвенции (дросселирование), наружу он не выходит; сигнал
// управления тождественно прежний, коэффициенты и bias 50 переобучать не надо.
//
// power пишется в VD pump-pwm-controller-<контур>, который сам публикует
// уровень и Switch в WB-MAO4 (см. pump-pwm-controller.js).
//
// Паузы (регулятор держит текущий power и не копит интеграл):
//   • ручная — канал hold;
//   • ГВС — канал gvs_hold включает учёт сухого контакта «запрос тепла бойлера»
//     (по умолчанию выключен: на линии сейчас постоянная 1, контакт не проверен);
//   • переходный процесс — резкое изменение подачи на 1 K за цикл (котёл
//     переключился на БКН или вернулся). Держим паузу 4 минуты, чтобы контур
//     вернулся, и только потом считаем снова.

var PidEngine = require('pid-engine.mod').PidEngine;

var PERIOD_SEC = 60;            // период расчёта
var MAX_STEP = 100;             // ограничение изменения power за цикл (10 % шкалы)
var TRANSIENT_K = 1.2;          // изменение подачи за 3 цикла, считаем переходным процессом
var TRANSIENT_SANE = 3.0;       // ΔT дальше этого от уставки физически неправдоподобна
var TRANSIENT_PAUSE_SEC = 240;  // сколько ждать после скачка
var GVS_TOPIC = "wb-mr6cv3_52/Input 2";

function clamp(v, lo, hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

function makeDeltaPid(name, title, deltaTopic, inletTopic, powerDevice) {
  var deviceName = "pump-delta-pid-" + name;
  var cellEnabled = deviceName + "/enabled";
  var cellSetpoint = deviceName + "/setpoint";
  var cellKp = deviceName + "/kp";
  var cellKi = deviceName + "/ki";
  var cellKd = deviceName + "/kd";
  var cellDeadband = deviceName + "/deadband";
  var cellBias = deviceName + "/bias";
  var cellHold = deviceName + "/hold";
  var cellGvsHold = deviceName + "/gvs_hold";
  var cellGvsLevel = deviceName + "/gvs_level";
  var cellDelta = deviceName + "/delta";
  var cellOutput = deviceName + "/output";
  var cellPower = deviceName + "/power";
  var cellStatus = deviceName + "/status";
  var cellSensorsOk = "delta-temp-" + name + "/valid";

  defineVirtualDevice(deviceName, {
    title: title,
    cells: {
      enabled: { title: "Включено", type: "switch", value: false, readonly: false, order: 1 },
      setpoint: { title: "Уставка ΔT, K", type: "range", value: 4, min: 0, max: 10, readonly: false, order: 2 },
      kp: { title: "Kp (%% на K)", type: "range", value: 8, min: 0, max: 200, readonly: false, order: 3 },
      ki: { title: "Ki", type: "range", value: 0.02, min: 0, max: 1, readonly: false, order: 4 },
      kd: { title: "Kd", type: "range", value: 0, min: 0, max: 200, readonly: false, order: 5 },
      deadband: { title: "Мёртвая зона, K", type: "range", value: 0.3, min: 0, max: 5, readonly: false, order: 6 },
      bias: { title: "Рабочая точка (скорость), %", type: "range", value: 50, min: 0, max: 100, readonly: false, order: 7 },
      hold: { title: "Пауза (ручная)", type: "switch", value: false, readonly: false, order: 8 },
      gvs_hold: { title: "Пауза по ГВС", type: "switch", value: false, readonly: false, order: 9 },
      gvs_level: { title: "Активный уровень ГВС (0/1)", type: "range", value: 1, min: 0, max: 1, readonly: false, order: 9.5 },
      delta: { title: "Текущая ΔT, K", type: "value", value: 0, readonly: true, order: 10 },
      output: { title: "Скорость насоса, %", type: "value", value: 0, readonly: true, order: 11 },
      power: { title: "Мощность насоса", type: "value", value: 0, readonly: true, order: 12 },
      status: { title: "Состояние", type: "text", value: "выключен", readonly: true, order: 13 }
    }
  });

  var powerCmdTopic = "/devices/" + powerDevice + "/controls/power/on";
  var powerStateTopic = powerDevice + "/power";  // dev[] принимает "<device>/<control>", не полный топик
  var errTopic = "/devices/" + deviceName + "/controls/power/meta/error";

  var pid = new PidEngine(dev[cellKp], dev[cellKi], dev[cellKd], dev[cellDeadband]);
  var lastPower = Number(dev[powerStateTopic]) || 0;
  var wasEnabled = false;
  var inletHistory = [];
  var pauseUntil = 0;

  // null, а не "": первый setError("") должен снять retained-ошибку прошлой сессии
  var lastErr = null;

  function setError(msg) {
    if (msg === lastErr) return;
    lastErr = msg;
    publish(errTopic, msg, 2, true);
  }

  function setStatus(text) {
    if (dev[cellStatus] !== text) dev[cellStatus] = text;
  }

  function setPower(value) {
    var v = clamp(Math.round(value), 0, 1000);
    if (Math.abs(v - lastPower) < 1) return;
    publish(powerCmdTopic, String(v), 0, false);
    lastPower = v;
    dev[cellPower] = v;
  }

  function cycle() {
    if (!dev[cellEnabled]) {
      // выключенный регулятор насос не трогает: power остаётся под ручным управлением
      pid.reset();
      wasEnabled = false;
      inletHistory = [];
      pauseUntil = 0;
      dev[cellOutput] = 0;
      setStatus("выключен");
      return;
    }

    if (!wasEnabled) {
      // в момент включения ставим рабочую точку в интегратор: при нулевой ошибке
      // регулятор не прыгает в край шкалы, а держит середину
      pid.reset();
      // bias задаётся в конвенции скорости насоса (как и канал output), а движок
      // считает в конвенции дросселирования — переводим: 100 − speed.
      pid.integral = 100 - Number(dev[cellBias]);
      pid.lastMeasurement = null;
      wasEnabled = true;
      inletHistory = [];
      pauseUntil = 0;
    }

    var now = Date.now();
    var inlet = Number(dev[inletTopic]);
    var measurement = Number(dev[deltaTopic]);

    // Переходный процесс — не только мгновенный скачок: при переключении котла
    // на БКН подача уходит плавно (наблюдалось −0,5 K/мин в течение 2,5 минут),
    // а возвращается рывком. Поэтому сравниваем с значением 3 цикла назад.
    // inlet < 5 °C — недостоверное чтение (канал ещё не опубликован, пересоздание VD).
    if (!isNaN(inlet) && inlet > 5) {
      inletHistory.push(inlet);
      if (inletHistory.length > 4) inletHistory.shift();
      if (inletHistory.length === 4 &&
          Math.abs(inletHistory[3] - inletHistory[0]) >= TRANSIENT_K) {
        log(name + ": подача ушла за 3 мин " + inletHistory[0] + " -> " + inletHistory[3] +
            ", пауза " + TRANSIENT_PAUSE_SEC + " с");
        pauseUntil = now + TRANSIENT_PAUSE_SEC * 1000;
        inletHistory = [inlet];
      }
    }

    if (dev[cellHold]) {
      setStatus("пауза: вручную");
      pid.lastMeasurement = null;   // иначе D на выходе из паузы считает скачок из старой точки
      return;
    }
    // ГВС: при включённом учёте недоступный топик (NaN) трактуем как «сигнал есть»
    // — без него нельзя доказать, что бойлер не греется, а гнать контур вслепую хуже паузы.
    if (dev[cellGvsHold]) {
      var gvsRaw = Number(dev[GVS_TOPIC]);
      if (isNaN(gvsRaw) || gvsRaw === Number(dev[cellGvsLevel])) {
        setStatus(isNaN(gvsRaw) ? "пауза: ГВС (нет сигнала)" : "пауза: ГВС");
        pid.lastMeasurement = null;
        return;
      }
    }
    if (now < pauseUntil) {
      setStatus("пауза: переходный процесс");
      pid.lastMeasurement = null;
      return;
    }
    if (!isNaN(measurement) && Math.abs(measurement - Number(dev[cellSetpoint])) > TRANSIENT_SANE) {
      log(name + ": ΔT " + measurement + " вне физического диапазона, пауза");
      pauseUntil = now + TRANSIENT_PAUSE_SEC * 1000;
      setStatus("пауза: ΔT вне диапазона");
      pid.lastMeasurement = null;
      return;
    }

    // Достоверность: delta-temp держит флаг valid. Ячейка delta при отвале датчика
    // замирает на последнем значении, поэтому одной проверки на NaN недостаточно.
    // !== true, а не === false: отсутствующий канал (переименование VD, порядок
    // загрузки) не должен читаться как «данные достоверны» — это fail-closed
    if (dev[cellSensorsOk] !== true || isNaN(measurement) || typeof dev[deltaTopic] !== "number") {
      setError("r");
      // следующая итерация пройдёт блок !wasEnabled: он сам сделает pid.reset()
      // и загрузит bias, поэтому отдельный reset здесь не нужен
      wasEnabled = false;
      dev[cellOutput] = 0;
      setPower(0);
      setStatus("нет данных датчиков — насос на минимум");
      return;
    }
    setError("");

    pid.kp = dev[cellKp];
    pid.ki = dev[cellKi];
    pid.kd = dev[cellKd];
    pid.deadband = dev[cellDeadband];

    var rawOut = pid.compute(dev[cellSetpoint], measurement, PERIOD_SEC);  // 0..100, где 100 = минимум оборотов
    var out = 100 - rawOut;                                               // наружу: скорость насоса, 0..100 %
    var target = out * 10;                                                // power = скорость × 10, без инверсии

    // ограничение скорости: не более MAX_STEP за цикл
    if (target > lastPower + MAX_STEP) target = lastPower + MAX_STEP;
    if (target < lastPower - MAX_STEP) target = lastPower - MAX_STEP;

    dev[cellDelta] = measurement;
    dev[cellOutput] = Math.round(out * 10) / 10;
    setPower(target);
    setStatus("работа");
  }

  setInterval(cycle, PERIOD_SEC * 1000);
  cycle();
}

// Подача ТП 1Э: с v3 delta-temp.js wb-ms_203 живёт на шаблоне WB-MS v2 (fw 4.36),
// где каналы по-датчиковые. Старого External Sensor 1 у устройства больше нет.
makeDeltaPid("underfloor-1", "ПИД насоса ТП 1Э (по ΔT)",
  "delta-temp-underfloor-1/delta", "wb-ms_203/bus1_temp1",
  "pump-pwm-controller-underfloor-heating-1");
makeDeltaPid("underfloor-2", "ПИД насоса ТП 2Э (по ΔT)",
  "delta-temp-underfloor-2/delta", "wb-ms_25/External Sensor 1",
  "pump-pwm-controller-underfloor-heating-2");
