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
            title: "Flow m/h",
            type: "water_flow",
            value: 0,
            readonly: true
        },
        flow_lm: {
            title: "Flow l/m",
            type: "value",
            value: 0,
            readonly: true
        }
      }
    });
  
    var dividerTopicName = deviceName + "/divider";
    var waterFlowTopicName = deviceName + "/flow"
    var waterFlowLMTopicName = deviceName + "/flow_lm"
    
    defineRule("weather-compensated-automation-" + name, {
      whenChanged: [
        inputFreqTopicName,
        dividerTopicName
      ],
      then: function(newValue, devName, cellName) {
        var dividerValue = dev[dividerTopicName];
        if (dividerValue != 0) {
            var freqValue = dev[inputFreqTopicName];
            var flowlm = freqValue * 60 / dividerValue
            dev[waterFlowLMTopicName] = flowlm;
            dev[waterFlowTopicName] = flowlm * 60 / 1000;
        } else {
            dev[waterFlowLMTopicName] = 0;
            dev[waterFlowTopicName] = 0;
        }
      }
    });
  }
  
  
  makePolitechWaterFlowSensor("pool-heat-exchanger", "wb-mcm8_238/Input 1 freq");