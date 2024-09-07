function updateSetpoint(
  enabledName,
  upperOutdoorName,
  upperInternalName,
  bottomOutdoorName,
  bottomInternalName,
  outdoorTempName,
  targetTempName
) {
  var enabled = dev[enabledName];
  if (enabled == false) {
    return;
  }
  var upperOutdoor = dev[upperOutdoorName];
  var upperInternal = dev[upperInternalName];
  var bottomOutdoor = dev[bottomOutdoorName];
  var bottomInternal = dev[bottomInternalName];
  var currentOutdoorTemp = dev[outdoorTempName];

  if (currentOutdoorTemp <= bottomOutdoor) {
    dev[targetTempName] = bottomInternal;
  } else if (currentOutdoorTemp >= upperOutdoor) {
    dev[targetTempName] = upperInternal;
  } else {
    var vDelta = upperInternal - bottomInternal;
    var hDelta = upperOutdoor - bottomOutdoor;
    var coef = vDelta / hDelta;
    var target = bottomInternal + (currentOutdoorTemp - bottomOutdoor) * coef;
    dev[targetTempName] = target;
  }
}

function makeWeatherCompensatedControl(
  name,
  inputTemperatureName,
  targetTemperatureName
) {
  var deviceName = "wca-settings-" + name;
  defineVirtualDevice(deviceName, {
    title: "WCA settings - " + name,
    cells: {
      enabled: {
	    type: "switch",
	    value: true,
        order: 1
      },
      upper_outdoor: {
        type: "temperature",
        value: 20,
        readonly: false,
        order: 2
      },
      upper_internal: {
        type: "temperature",
        value: 35,
        readonly: false,
        order: 3
      },
      bottom_outdoor: {
        type: "temperature",
        value: 25,
        readonly: false,
        order: 4
      },
      bottom_internal: {
        type: "temperature",
        value: 35,
        readonly: false,
        order: 5
      }
    }
  });

  var enabledName = deviceName + "/enabled";
  var upperOutdoorName = deviceName + "/upper_outdoor";
  var upperInternalName = deviceName + "/upper_internal";
  var bottomOutdoorName = deviceName + "/bottom_outdoor";
  var bottomInternalName = deviceName + "/bottom_internal";
  
  defineRule("weather-compensated-automation-" + name, {
    whenChanged: [
      enabledName,
      upperOutdoorName,
      upperInternalName,
      bottomOutdoorName,
      bottomInternalName,
      inputTemperatureName
    ],
    then: function(newValue, devName, cellName) {
      updateSetpoint(
        enabledName,
        upperOutdoorName,
        upperInternalName,
        bottomOutdoorName,
        bottomInternalName,
        inputTemperatureName,
        targetTemperatureName
      );
    }
  });
}


makeWeatherCompensatedControl("heated_floor_1", "wb-m1w2_33/External Sensor 1", "owen-trm12_10/set-value-1");

makeWeatherCompensatedControl("heated_floor_2", "wb-m1w2_33/External Sensor 1", "owen-trm12_11/set-value-1");

