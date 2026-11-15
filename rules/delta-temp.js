// Version: 1
// ΔT контуров тёплого пола: подача − обратка.
// Источники: wb-ms_203 (ТП 1Э) и wb-ms_25 (ТП 2Э),
// External Sensor 1 = подача, External Sensor 2 = обратка (накладной датчик).
// Значение отдаётся в delta-temp-<контур>/delta — его читает ПИД-регулятор насоса.

function makeDeltaTemp(name, title, inletTopic, outletTopic) {
  var deviceName = "delta-temp-" + name;
  var cellInlet = deviceName + "/inlet";
  var cellOutlet = deviceName + "/outlet";
  var cellDelta = deviceName + "/delta";

  defineVirtualDevice(deviceName, {
    title: title,
    cells: {
      inlet: { title: "Подача, °C", type: "temperature", value: 0, readonly: true },
      outlet: { title: "Обратка, °C", type: "temperature", value: 0, readonly: true },
      delta: { title: "ΔT, K", type: "value", value: 0, readonly: true }
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
    dev[cellInlet] = a;
    dev[cellOutlet] = b;
    dev[cellDelta] = Math.round((a - b) * 100) / 100;
  }

  defineRule("delta-temp-recalc-" + name, {
    whenChanged: [inletTopic, outletTopic],
    then: recalc
  });

  recalc();
}

makeDeltaTemp("underfloor-1", "ΔT ТП 1Э",
  "wb-ms_203/External Sensor 1", "wb-ms_203/External Sensor 2");
makeDeltaTemp("underfloor-2", "ΔT ТП 2Э",
  "wb-ms_25/External Sensor 1", "wb-ms_25/External Sensor 2");
