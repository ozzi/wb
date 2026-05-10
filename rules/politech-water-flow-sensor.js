// Version: 1

function makePolitechWaterFlowSensor(
  name,
  inputFreqTopicName
) {
  var deviceName = "politech-water-flow-sensor-" + name;
  defineVirtualDevice(deviceName, {
    title: "Politech Water Flow Sensor - " + name,
    cells: {
      divider: {
          title: "Divider",
          type: "range",
          value: 225,
          max: 1000,
          min: 0
      },
      flow: {
          title: "Flow m3/h",
          type: "water_flow",
          value: 0,
          readonly: true
      },
      flow_lm: {
          title: "Flow l/m",
          type: "value",
          value: 0,
          readonly: true
      },
      correction_percentage: {
          title: "Correction percentage",
          type: "range",
          value: 0,
          max: 25,
          min: -25,
          readonly: false
      }
    }
  });

  var dividerTopicName = deviceName + "/divider";
  var correctionPercentageTopicName = deviceName + "/correction_percentage";
  var waterFlowTopicName = deviceName + "/flow";
  var waterFlowLMTopicName = deviceName + "/flow_lm";
  
  defineRule("politech-water-flow-automation-" + name, {
    whenChanged: [
      inputFreqTopicName,
      dividerTopicName,
      correctionPercentageTopicName
    ],
    then: function(newValue, devName, cellName) {
      var dividerValue = dev[dividerTopicName];
      var correctionPercentageVal = dev[correctionPercentageTopicName];
      if (dividerValue != 0) {
          var freqValue = dev[inputFreqTopicName];
          var flowlm = freqValue * 60 / dividerValue * (100 + correctionPercentageVal) / 100;
          dev[waterFlowLMTopicName] = flowlm;
          dev[waterFlowTopicName] = flowlm * 60 / 1000;
      } else {
          dev[waterFlowLMTopicName] = 0;
          dev[waterFlowTopicName] = 0;
      }
    }
  });
}


makePolitechWaterFlowSensor("asic", "wb-mcm8_238/Input 1 freq");
makePolitechWaterFlowSensor("pool-heat-exchanger", "wb-mcm8_238/Input 2 freq");
makePolitechWaterFlowSensor("dry-cooling", "wb-mcm8_238/Input 3 freq");
