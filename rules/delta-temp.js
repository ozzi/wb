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
// Поправка по ночным окнам БКН (15→16.11.2026): при отсутствии подвода тепла
// min ΔT держалась 0,98…1,13 K (три независимых эпизода), то есть обратка читается
// заниженной примерно на 1,0 K. Принято offset_outlet = +1,06 K — это ВЕРХНЯЯ
// граница (в неё входит остаточный перепад от теплоотдачи в стяжку), поэтому
// при появлении более точных данных (останов насоса / оба датчика на одной трубе)
// значение надо уточнить, а не считать окончательным.

function makeDeltaTemp(name, title, inletTopic, outletTopic, offsetInlet, offsetOutlet) {
  var deviceName = "delta-temp-" + name;
  var cellInlet = deviceName + "/inlet";
  var cellOutlet = deviceName + "/outlet";
  var cellDelta = deviceName + "/delta";
  var cellOffIn = deviceName + "/offset_inlet";
  var cellOffOut = deviceName + "/offset_outlet";

  defineVirtualDevice(deviceName, {
    title: title,
    cells: {
      inlet: { title: "Подача, °C", type: "temperature", value: 0, readonly: true, order: 1 },
      outlet: { title: "Обратка, °C", type: "temperature", value: 0, readonly: true, order: 2 },
      delta: { title: "ΔT, K", type: "value", value: 0, readonly: true, order: 3 },
      offset_inlet: { title: "Поправка подачи, K", type: "range", value: offsetInlet, min: -5, max: 5, readonly: false, order: 4 },
      offset_outlet: { title: "Поправка обратки, K", type: "range", value: offsetOutlet, min: -5, max: 5, readonly: false, order: 5 }
    }
  });

  var errorTopic = "/devices/" + deviceName + "/controls/delta/meta/error";

  function recalc() {
    var a = dev[inletTopic];
    var b = dev[outletTopic];
    if (typeof a !== "number" || typeof b !== "number" || isNaN(a) || isNaN(b)) {
      publish(errorTopic, "r", 2, true);
      return;
    }
    publish(errorTopic, "", 2, true);
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
  "wb-ms_25/External Sensor 1", "wb-ms_25/External Sensor 2", 0, 1.06);
