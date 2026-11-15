// Version: 1
// Регулирование насоса ТП по ΔT (подача − обратка) на штатном ПИД-движке Wiren Board.
//
// Движок: require('pid-engine.mod').PidEngine (пакет wb-scenarios) —
// P по ошибке, I с anti-windup (0..100), D по измерению с ФНЧ, мёртвая зона
// как снижение усиления до 10 %.
//
// Задача: держать заданную ΔT контура. Связь обратная — чем больше расход,
// тем меньше ΔT, поэтому выход ПИД (0..100 %) инвертируется в power насоса:
// ПИД 0 % → power 1000 (максимум оборотов), ПИД 100 % → power 0 (минимум).
// power пишется в VD pump-pwm-controller-<контур>, который сам публикует
// уровень и Switch в WB-MAO4 (см. pump-pwm-controller.js).

var PidEngine = require('pid-engine.mod').PidEngine;

var PERIOD_SEC = 60;          // период расчёта
var MAX_STEP = 100;           // ограничение изменения power за цикл (10 % шкалы)

function clamp(v, lo, hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

function makeDeltaPid(name, title, deltaTopic, powerDevice) {
  var deviceName = "pump-delta-pid-" + name;
  var cellEnabled = deviceName + "/enabled";
  var cellSetpoint = deviceName + "/setpoint";
  var cellKp = deviceName + "/kp";
  var cellKi = deviceName + "/ki";
  var cellKd = deviceName + "/kd";
  var cellDeadband = deviceName + "/deadband";
  var cellBias = deviceName + "/bias";
  var cellDelta = deviceName + "/delta";
  var cellOutput = deviceName + "/output";
  var cellPower = deviceName + "/power";

  defineVirtualDevice(deviceName, {
    title: title,
    cells: {
      enabled: { title: "Включено", type: "switch", value: false, readonly: false, order: 1 },
      setpoint: { title: "Уставка ΔT, K", type: "range", value: 4, min: 0, max: 10, readonly: false, order: 2 },
      kp: { title: "Kp (%% на K)", type: "range", value: 8, min: 0, max: 200, readonly: false, order: 3 },
      ki: { title: "Ki", type: "range", value: 0.02, min: 0, max: 1, readonly: false, order: 4 },
      kd: { title: "Kd", type: "range", value: 0, min: 0, max: 200, readonly: false, order: 5 },
      deadband: { title: "Мёртвая зона, K", type: "range", value: 0.3, min: 0, max: 5, readonly: false, order: 6 },
      bias: { title: "Рабочая точка, %", type: "range", value: 50, min: 0, max: 100, readonly: false, order: 7 },
      delta: { title: "Текущая ΔT, K", type: "value", value: 0, readonly: true, order: 10 },
      output: { title: "Выход ПИД, %", type: "value", value: 0, readonly: true, order: 11 },
      power: { title: "Мощность насоса", type: "value", value: 0, readonly: true, order: 12 }
    }
  });

  var powerCmdTopic = "/devices/" + powerDevice + "/controls/power/on";
  var powerStateTopic = powerDevice + "/power";  // dev[] принимает "<device>/<control>", не полный топик
  var errTopic = "/devices/" + deviceName + "/controls/power/meta/error";

  var pid = new PidEngine(dev[cellKp], dev[cellKi], dev[cellKd], dev[cellDeadband]);
  var lastPower = Number(dev[powerStateTopic]) || 0;
  var wasEnabled = false;

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
      dev[cellOutput] = 0;
      return;
    }

    if (!wasEnabled) {
      // в момент включения ставим рабочую точку в интегратор: при нулевой ошибке
      // регулятор не прыгает в край шкалы, а держит середину
      pid.reset();
      pid.integral = dev[cellBias];
      wasEnabled = true;
    }

    var measurement = dev[deltaTopic];
    if (typeof measurement !== "number" || isNaN(measurement)) {
      publish(errTopic, "r", 2, true);
      pid.reset();
      dev[cellOutput] = 0;
      setPower(0);
      return;
    }
    publish(errTopic, "", 2, true);

    pid.kp = dev[cellKp];
    pid.ki = dev[cellKi];
    pid.kd = dev[cellKd];
    pid.deadband = dev[cellDeadband];

    var out = pid.compute(dev[cellSetpoint], measurement, PERIOD_SEC);  // 0..100
    var target = 1000 - out * 10;                                        // инверсия: больше ΔT -> больше оборотов

    // ограничение скорости: не более MAX_STEP за цикл
    if (target > lastPower + MAX_STEP) target = lastPower + MAX_STEP;
    if (target < lastPower - MAX_STEP) target = lastPower - MAX_STEP;

    dev[cellDelta] = measurement;
    dev[cellOutput] = Math.round(out * 10) / 10;
    setPower(target);
  }

  setInterval(cycle, PERIOD_SEC * 1000);
  cycle();
}

makeDeltaPid("underfloor-1", "ПИД насоса ТП 1Э (по ΔT)",
  "delta-temp-underfloor-1/delta", "pump-pwm-controller-underfloor-heating-1");
makeDeltaPid("underfloor-2", "ПИД насоса ТП 2Э (по ΔT)",
  "delta-temp-underfloor-2/delta", "pump-pwm-controller-underfloor-heating-2");
