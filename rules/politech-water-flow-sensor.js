function MovingAverage(windowSize) {
  if (windowSize <= 0) {
      throw new Error("Window size must be greater than zero");
  }

  this.windowSize = windowSize;
  this.data = [];
}

MovingAverage.prototype.resize = function(value) {
if (this.windowSize > value) {
  this.data.splice(0, value);
}
this.windowSize = value;
}

MovingAverage.prototype.getWindowSize = function() {
return this.windowSize;
}

MovingAverage.prototype.add = function(value) {
  this.data.push(value);
  if (this.data.length > this.windowSize) {
      this.data.shift();
  }
  var sum = 0;
  for (var i = 0; i < this.data.length; i++) {
      sum += this.data[i];
  }
  return sum / this.data.length;
};

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
      flow_lm_ma: {
          title: "Flow l/m Moving Average",
          type: "value",
          value: 0,
          readonly: true
      },
      window_size: {
          title: "Windows size for moving average",
          type: "range",
          value: 10,
          max: 100,
          min: 1,
          readonly: false
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
  var windowSizeTopicName = deviceName + "/window_size";
  var correctionPercentageTopicName = deviceName + "/correction_percentage";
  var windowSizeValue = dev[windowSizeTopicName];
  var waterFlowTopicName = deviceName + "/flow";
  var waterFlowLMTopicName = deviceName + "/flow_lm";
  var waterFlowLMMATopicName = deviceName + "/flow_lm_ma";
  var movingAverage = new MovingAverage(windowSizeValue);
  
  defineRule("politech-water-flow-automation-" + name, {
    whenChanged: [
      inputFreqTopicName,
      dividerTopicName,
      windowSizeTopicName,
      correctionPercentageTopicName
    ],
    then: function(newValue, devName, cellName) {
      var dividerValue = dev[dividerTopicName];
      var windowSizeVal = dev[windowSizeTopicName];
      var correctionPercentageVal = dev[correctionPercentageTopicName];
      if (windowSizeVal != movingAverage.getWindowSize()) {
        movingAverage.resize(windowSizeVal);
      }
      if (dividerValue != 0) {
          var freqValue = dev[inputFreqTopicName];
          var flowlm = freqValue * 60 / dividerValue * (100 + correctionPercentageVal) / 100;
          dev[waterFlowLMTopicName] = flowlm;
          dev[waterFlowTopicName] = flowlm * 60 / 1000;
      } else {
          dev[waterFlowLMTopicName] = 0;
          dev[waterFlowTopicName] = 0;
      }
      dev[waterFlowLMMATopicName] = movingAverage.add(dev[waterFlowLMTopicName]);
    }
  });
}


makePolitechWaterFlowSensor("asic", "wb-mcm8_238/Input 1 freq");
makePolitechWaterFlowSensor("pool-heat-exchanger", "wb-mcm8_238/Input 2 freq");
makePolitechWaterFlowSensor("dry-cooling", "wb-mcm8_238/Input 3 freq");