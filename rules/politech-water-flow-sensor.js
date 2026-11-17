// Version: 2
// Датчик протока Politech (импульсный выход, 225 имп/л) на частото-мерном входе WB.
// Активен только первичное кольцо (wb-mr6cv3_52 Input 5 freq). Датчики asic,
// dry-cooling и underfloor-heating-1 сняты 15.11.2026, их виртуальные устройства
// и сущности в HA удалены — при возврате датчика добавить строку makePolitechWaterFlowSensor.

function makePolitechWaterFlowSensor(name, inputFreqTopicName) {
  var deviceName = "politech-water-flow-sensor-" + name;
  var cellDivider = deviceName + "/divider";
  var cellFlowLM = deviceName + "/flow_lm";
  var lastSentValue = -1;

  defineVirtualDevice(deviceName, {
    title: "Politech Water Flow Sensor - " + name,
    cells: {
      divider: { type: "range", value: 225, max: 1000, min: 0 },
      flow_lm: { title: "Flow l/m", type: "value", value: 0, readonly: true }
    }
  });

  defineRule("politech-wf-auto-" + name, {
    whenChanged: [inputFreqTopicName, cellDivider],
    then: function () {
      var f = dev[inputFreqTopicName] || 0;
      var d = dev[cellDivider];
      if (d <= 0) return;

      var newVal = (f * 60) / d;

      if (Math.abs(newVal - lastSentValue) > 0.1 || (newVal === 0 && lastSentValue !== 0) || (newVal !== 0 && lastSentValue === 0)) {
        dev[cellFlowLM] = newVal;
        lastSentValue = newVal;
      }
    }
  });
}

makePolitechWaterFlowSensor("primary-ring", "wb-mr6cv3_52/Input 5 freq");
