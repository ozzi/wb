// Version: 2
// ΔT контуров тёплого пола: подача − обратка, с поправками на накладной монтаж.
//
// Источники: wb-ms_203 (ТП 1Э) и wb-ms_25 (ТП 2Э),
// External Sensor 1 = подача, External Sensor 2 = обратка (накладной датчик).
//
// v2: каналы offset_inlet / offset_outlet — смещение каждого датчика в K,
// прибавляется к показанию перед вычитанием:
//     delta = (inlet + offset_inlet) - (outlet + offset_outlet)
//
// Поправки по умолчанию — 0. Плато ΔT в окне БКН при работающем насосе это
// теплоотдача в стяжку, а не смещение датчиков: 17.11.2026 проверено остановом
// насоса на 9 минут — сырая ΔT ушла 0,57 → 0,07 K за 1,5 мин и пересекла ноль,
// то есть пара датчиков ТП 2Э сходится в пределах ±0,25 K. Значение поправки
// задаётся каналом offset_* по результату калибровки (оба датчика на одну трубу
// или останов насоса), а не переносится из наблюдений за плато.

function makeDeltaTemp(name, title, inletTopic, outletTopic, offsetInlet, offsetOutlet) {
  var deviceName = "delta-temp-" + name;
  var cellInlet = deviceName + "/inlet";
  var cellOutlet = deviceName + "/outlet";
  var cellDelta = deviceName + "/delta";
  var cellOffIn = deviceName + "/offset_inlet";
  var cellOffOut = deviceName + "/offset_outlet";
  var cellValid = deviceName + "/valid";

  defineVirtualDevice(deviceName, {
    title: title,
    cells: {
      inlet: { title: "Подача, °C", type: "temperature", value: 0, readonly: true, order: 1 },
      outlet: { title: "Обратка, °C", type: "temperature", value: 0, readonly: true, order: 2 },
      delta: { title: "ΔT, K", type: "value", value: 0, readonly: true, order: 3 },
      offset_inlet: { title: "Поправка подачи, K", type: "range", value: offsetInlet, min: -5, max: 5, readonly: false, order: 4 },
      offset_outlet: { title: "Поправка обратки, K", type: "range", value: offsetOutlet, min: -5, max: 5, readonly: false, order: 5 },
      valid: { title: "Данные датчиков достоверны", type: "switch", value: false, readonly: true, order: 6 }
    }
  });

  var errorTopic = "/devices/" + deviceName + "/controls/delta/meta/error";

  // meta/error публикуем только при смене состояния: событие приходит на каждый
  // отсчёт датчика (десятки раз в минуту), а пустой retained-пакет каждый раз — лишний трафик
  var lastError = "";

  function setError(msg) {
    if (msg === lastError) return;
    lastError = msg;
    publish(errorTopic, msg, 2, true);
  }

  function recalc() {
    var a = dev[inletTopic];
    var b = dev[outletTopic];
    if (typeof a !== "number" || typeof b !== "number" || isNaN(a) || isNaN(b)) {
      // ячейки остаются на последнем значении, поэтому потребитель (ПИД) смотрит
      // не на delta, а на флаг valid — иначе он считает по застывшему числу
      setError("r");
      dev[cellValid] = false;
      return;
    }
    setError("");
    dev[cellValid] = true;
    var offIn = Number(dev[cellOffIn]) || 0;
    var offOut = Number(dev[cellOffOut]) || 0;
    dev[cellInlet] = a;
    dev[cellOutlet] = b;
    dev[cellDelta] = Math.round(((a + offIn) - (b + offOut)) * 100) / 100;
  }

  defineRule("delta-temp-recalc-" + name, {
    whenChanged: [inletTopic, outletTopic],
    then: recalc
  });

  // при изменении поправки пересчитываем сразу, не дожидаясь нового отсчёта
  defineRule("delta-temp-offset-" + name, {
    whenChanged: [cellOffIn, cellOffOut],
    then: recalc
  });

  recalc();
}

makeDeltaTemp("underfloor-1", "ΔT ТП 1Э",
  "wb-ms_203/External Sensor 1", "wb-ms_203/External Sensor 2", 0, 0);
makeDeltaTemp("underfloor-2", "ΔT ТП 2Э",
  "wb-ms_25/External Sensor 1", "wb-ms_25/External Sensor 2", 0, 0);
