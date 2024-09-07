var currentsSnapshotMap = {};
var totalCurrentsMap = {};
var limiterTopicName = "wb-mio-gpio_44:1/K7";
var heatingTopicsName = [
  "wb-map12e_12/Ch 2 Irms L1",
  "wb-map12e_12/Ch 2 Irms L2",
  "wb-map12e_12/Ch 2 Irms L3"
];
var lastHeatingCurrent = 0;
var defaultHeatingCurrent = 0;

function updateCurrents(devName, cellName, newValue) {
  if (devName === "wb-map12e_12") {
    currentsSnapshotMap[cellName] = newValue;
    var _totalCurrent = 0.0;
    var _currentsSnapshotKeys = Object.keys(currentsSnapshotMap);
    for (var _i = 0; _i < _currentsSnapshotKeys.length; ++_i) {
      var _key = _currentsSnapshotKeys[_i];
      var _value = currentsSnapshotMap[_key];
      var _floatValue = parseFloat(_value);
      _totalCurrent += _floatValue;
    }
    var _now = new Date();
    totalCurrentsMap[_now] = _totalCurrent;
  }
  filterTotalCurrents();
}

function filterMapByAge(mapForFilter, age) {
  var _filteredMap = {};
  var _keys = Object.keys(mapForFilter);
  var _now = new Date();
  for (var _i = 0; _i < _keys.length; ++_i) {
    var _key = _keys[_i];
    var _date = new Date(_key);
    var _value = mapForFilter[_key];
    var _diff = _now - _date;
    if (_diff < age) {
      _filteredMap[_key] = _value;
    }
  }
  return _filteredMap;
}

function filterTotalCurrents() {
  var _timeOff = parseInt(dev["current-limiter-settings/time_window_off"]);
  var _timeOn = parseInt(dev["current-limiter-settings/time_window_on"]);
  var _maxTime = Math.max(_timeOff, _timeOn);
  _maxTime = Math.max(1, _maxTime);
  var _threshold = _maxTime * 1000;
  totalCurrentsMap = filterMapByAge(totalCurrentsMap, _threshold);
}

function updateHeatingCurrent() {
  var _state = dev[limiterTopicName];
  if (_state == false) {
    return;
  }
  var _sum = 0.0;
  for (var _i = 0; _i < heatingTopicsName.length; _i++) {
    var _topic = heatingTopicsName[_i];
    var _value = parseFloat(dev[_topic]);
    _sum += _value;
  }
  lastHeatingCurrent = _sum;
}

function calculateAverageCurrents() {
  var _timeOffValue = parseInt(dev["current-limiter-settings/time_window_off"]);
  _timeOffValue = Math.max(1, _timeOffValue);
  var _timeOff = _timeOffValue * 1000;
  var _map = filterMapByAge(totalCurrentsMap, _timeOff);
  var _totalCurrentsKeys = Object.keys(_map);
  var _sum = 0.0;
  for (var _i = 0; _i < _totalCurrentsKeys.length; ++_i) {
    var _key = _totalCurrentsKeys[_i];
    var _value = _map[_key];
    _sum += _value;
  }
  var _average = 0.0;
  if (_totalCurrentsKeys.length > 0) {
    _average = _sum / _totalCurrentsKeys.length;
  }
  //log("calculateAverageCurrents {} count {}", _average, _totalCurrentsKeys.length);
  return _average;
}

function calculateMaxCurrents() {
  var _timeOnValue = parseInt(dev["current-limiter-settings/time_window_on"]);
  _timeOnValue = Math.max(1, _timeOnValue);
  var _timeOn = _timeOnValue * 1000;
  var _map = filterMapByAge(totalCurrentsMap, _timeOn);
  var _totalCurrentsKeys = Object.keys(_map);
  var _max = 0;
  for (var _i = 0; _i < _totalCurrentsKeys.length; ++_i) {
    var _key = _totalCurrentsKeys[_i];
    var _value = _map[_key];
    if (_i == 0) {
      _max = _value
    } else if (_value > _max) {
      _max = _value;
    }
  }
  //log("calculateMaxCurrents {} count {}", _max, _totalCurrentsKeys.length);
  return _max;
}


function calculateLimitValue() {
  var _isHeatingEnabled = dev[limiterTopicName];
  var _threshold = parseInt(dev["current-limiter-settings/limit_value"]);
  var _average = calculateAverageCurrents();
  var _max = calculateMaxCurrents();
  var _result = true;
  if (_isHeatingEnabled == false) {
    if (_max + lastHeatingCurrent - defaultHeatingCurrent > _threshold) {
      //log("max {} lastHeatingCurrent {}", _max, lastHeatingCurrent);
      _result = false;
    } else {
      log("need turn on action max {} <= limit {}", _max, _threshold);
      _result = true;
    }
  } else {
    if (_average > _threshold) {
      log("need turn off action average {} > limit {}", _average, _threshold);
      _result = false;
    } else {
      _result = true;
    }
  }
  return _result;
}

defineVirtualDevice("current-limiter-settings", {
    title: "Limiter settings",
    cells: {
      enabled: {
	    type: "switch",
	    value: true
      },
      limit_value: {
        type: "range",
        value: 63,
        min: 0,
        max: 63
      },
      time_window_off: {
        type: "range",
        value: 3,
        min: 1,
        max: 15
      },
      time_window_on: {
        type: "range",
        value: 60,
        min: 15,
        max: 300
      }
    }
});

defineRule("limiter_v00", {
    whenChanged: [
      "wb-map12e_12/Ch 1 Irms L1",
      "wb-map12e_12/Ch 1 Irms L2",
      "wb-map12e_12/Ch 1 Irms L3",
      "wb-map12e_12/Ch 2 Irms L1",
      "wb-map12e_12/Ch 2 Irms L2",
      "wb-map12e_12/Ch 2 Irms L3",
      "wb-map12e_12/Ch 3 Irms L1",
      "wb-map12e_12/Ch 3 Irms L2",
      "wb-map12e_12/Ch 3 Irms L3",
      "wb-map12e_12/Ch 4 Irms L1",
      "wb-map12e_12/Ch 4 Irms L2",
      "wb-map12e_12/Ch 4 Irms L3",
      "current-limiter-settings/enabled",
      "current-limiter-settings/limit_value",
      "current-limiter-settings/time_window_off",
      "current-limiter-settings/time_window_on"
    ],
    then: function(newValue, devName, cellName) {
      updateHeatingCurrent();
      updateCurrents(devName, cellName, newValue);
      var _isLimiterEnabled = parseInt(dev["current-limiter-settings/enabled"]);
      if (_isLimiterEnabled == false) {
        return;
      }
      var _calcLimitValue = calculateLimitValue();
      var _currentValue = dev[limiterTopicName];
      if (_calcLimitValue != _currentValue) {
        log("need switch limiter topic {} vs {}", _calcLimitValue, _currentValue);
        dev[limiterTopicName] = _calcLimitValue;
      } 
    }
});