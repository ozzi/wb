function performGET(
  host,
  endpoint,
  callback
) {
  var command = 'curl -s --connect-timeout 2 --max-time 2 -X GET {}{}'.format(
    host,
    endpoint
  );

  runShellCommand(
    command,
    {
      captureOutput: true,
      exitCallback: function (exitCode, capturedOutput) {
        if (exitCode === 0) {
          callback(capturedOutput);
        } else {
          callback(null);
        }
      }
    });
}

function performPOST(
  host,
  endpoint,
  apikey,
  callback
) {
  var command = 'curl -s --connect-timeout 2 --max-time 5 -X POST {}{} -H \'x-api-key: {}\''.format(
    host,
    endpoint,
    apikey
  );

  runShellCommand(
    command,
    {
      captureOutput: false,
      exitCallback: function (exitCode) {
        if (exitCode === 0) {
          callback(true);
        } else {
          callback(false);
        }
      }
    });
}

function performPayloadPOST(
  host,
  endpoint,
  apikey,
  payload,
  callback
) {
  var command = 'curl -s --connect-timeout 2 --max-time 5 -X POST {}{} -H \'x-api-key: {}\' -H \'Content-Type: application/json\' -d \'{}\''.format(
    host,
    endpoint,
    apikey,
    payload
  );

  runShellCommand(
    command,
    {
      captureOutput: false,
      exitCallback: function (exitCode) {
        if (exitCode === 0) {
          callback(true);
        } else {
          callback(false);
        }
      }
    });
}

function postMiningPause(host, apikey, callback) {
  performPOST(host, "/api/v1/mining/pause", apikey, callback);
}

function postMiningResume(host, apikey, callback) {
  performPOST(host, "/api/v1/mining/resume", apikey, callback);
}

function postMiningStop(host, apikey, callback) {
  performPOST(host, "/api/v1/mining/stop", apikey, callback);
}

function postMiningStart(host, apikey, callback) {
  performPOST(host, "/api/v1/mining/start", apikey, callback);
}

function postMiningRestart(host, apikey, callback) {
  performPOST(host, "/api/v1/mining/restart", apikey, callback);
}

function postUpdatePerformancePreset(host, apikey, preset, callback) {
  var settings = "{\"miner\":{\"overclock\":{\"preset\":\"{}\"}}}".format(preset);
  performPayloadPOST(host, "/api/v1/settings", apikey, settings, callback);
}

function getBoardTemperatures(sensors, excludedLocIds) {
  if (!sensors || sensors.length === 0) {
    return { min: undefined, max: undefined };
  }

  var filteredSensors = sensors.filter(function (sensor) {
    return excludedLocIds.indexOf(sensor.loc) === -1;
  });

  if (filteredSensors.length === 0) {
    return { min: undefined, max: undefined };
  }

  var min = filteredSensors[0].board;
  var max = filteredSensors[0].board;

  for (var i = 1; i < filteredSensors.length; i++) {
    var boardTemp = filteredSensors[i].board;
    if (boardTemp < min) min = boardTemp;
    if (boardTemp > max) max = boardTemp;
  }

  return { min: min, max: max };
}

function processSensorsTemperatures(data, excludedLocIds) {
  var result = {};
  if (!data || !Array.isArray(data)) return result;

  for (var i = 0; i < data.length; i++) {
    var item = data[i];
    var id = item.id;

    if (id !== undefined) {
      var inletFromSensors = undefined;
      var outletFromSensors = undefined;

      if (item.sensors && Array.isArray(item.sensors)) {
        for (var j = 0; j < item.sensors.length; j++) {
          var s = item.sensors[j];
          if (s.loc === 41) inletFromSensors = s.board;
          if (s.loc === 50) outletFromSensors = s.board;
        }
      }

      var boardTemps = getBoardTemperatures(item.sensors, excludedLocIds);

      result[id] = {
        min: boardTemps.min,
        max: boardTemps.max,
        inlet: inletFromSensors,
        outlet: outletFromSensors
      };
    }
  }
  return result;
}

function processWaterTemperatures(data) {
  var result = {};
  if (!data || !Array.isArray(data)) return result;

  for (var i = 0; i < data.length; i++) {
    var item = data[i];
    if (item.id !== undefined &&
      item.inlet_water_temp !== undefined && item.inlet_water_temp !== null &&
      item.outlet_water_temp !== undefined && item.outlet_water_temp !== null) {

      result[item.id] = {
        inlet: item.inlet_water_temp,
        outlet: item.outlet_water_temp
      };
    }
  }
  return result;
}

function getSummary(host, callback) {
  performGET(
    host,
    "/api/v1/summary",
    function (serverResponse) {
      if (serverResponse == null) {
        callback("unavailable", 0);
      } else {
        var response;
        try {
          response = JSON.parse(serverResponse);
        } catch (e) {
          log("getSummary: JSON.parse failed: {}", e);
          callback("unavailable", 0);
          return;
        }
        var state = response["miner"]["miner_status"]["miner_state"];
        var powerStr = response["miner"]["power_consumption"];
        var power = parseInt(powerStr);
        callback(state, power);
      }
    }
  );
}

function getPerfSummary(host, callback) {
  performGET(
    host,
    "/api/v1/perf-summary",
    function (serverResponse) {
      if (serverResponse == null) {
        callback(0);
      } else {
        var response;
        try {
          response = JSON.parse(serverResponse);
        } catch (e) {
          log("getPerfSummary: JSON.parse failed: {}", e);
          callback(0);
          return;
        }
        var presetStr = response["current_preset"]["name"];
        var preset = parseInt(presetStr);
        callback(preset);
      }
    }
  );
}

function getChains(host, callback) {
  performGET(
    host,
    "/api/v1/chains",
    function (serverResponse) {
      if (serverResponse == null) {
        callback([]);
      } else {
        var response;
        try {
          response = JSON.parse(serverResponse);
        } catch (e) {
          log("getChains: JSON.parse failed: {}", e);
          callback([]);
          return;
        }
        var temps = processSensorsTemperatures(response, [41, 50]);
        callback(temps);
      }
    }
  );
}

function isNightRate() {
  var currentTime = new Date();
  var currentHour = currentTime.getHours();

  // Ночной тариф с 23:00 до 7:00
  return currentHour >= 23 || currentHour < 7;
}

function isPeakRate() {
  var currentTime = new Date();
  var currentHour = currentTime.getHours();

  // Пиковый тариф с 07:00 до 10:00 и с 17:00 до 21:00
  return (currentHour >= 7 && currentHour < 10) || (currentHour >= 17 && currentHour < 21);
}

function applySchedulePreset(deviceName, scheduleModeTopicName, selectedPresetTopicName) {
  var scheduleMode = dev[scheduleModeTopicName];
  if (scheduleMode == "peak-offpeak-night") {
    if (isNightRate()) {
      dev[selectedPresetTopicName] = "performance";
    } else if (isPeakRate()) {
      dev[selectedPresetTopicName] = "lowpower";
    } else {
      dev[selectedPresetTopicName] = "optimal";
    }
  }
}

function buildVNISHDevice(
  deviceName,
  hostName,
  timeframe
) {
  defineVirtualDevice(deviceName, {
    title: "VNISH DEVICE " + deviceName,
    cells: {
      enabled: {
        title: "enabled",
        type: "switch",
        value: false,
        order: 1
      },
      apikey: {
        title: "api key",
        type: "text",
        value: "",
        readonly: false,
        order: 2
      },
      state: {
        title: "miner state",
        type: "text",
        value: "",
        readonly: true,
        order: 3
      },
      current_preset: {
        title: "current preset",
        type: "value",
        value: 0,
        readonly: true,
        order: 4
      },
      power: {
        title: "current power",
        type: "value",
        value: 0,
        readonly: true,
        order: 5
      },
      start_mining: {
        title: "start mining",
        type: "pushbutton",
        order: 6
      },
      stop_mining: {
        title: "stop mining",
        type: "pushbutton",
        order: 7
      },
      pause_mining: {
        title: "pause mining",
        type: "pushbutton",
        order: 8
      },
      resume_mining: {
        title: "resume mining",
        type: "pushbutton",
        order: 9
      },
      restart_mining: {
        title: "restart mining",
        type: "pushbutton",
        order: 10
      },
      selected_preset: {
        title: "selected preset",
        type: "text",
        value: "optimal",
        readonly: false,
        enum: {
          "optimal": { en: "Optimal", ru: "Оптимальный" },
          "lowpower": { en: "Low power", ru: "Низкое энергопотребление" },
          "performance": { en: "Performance", ru: "Производительный" }
        },
        order: 11
      },
      performance_preset: {
        title: "performance preset",
        type: "value",
        value: 0,
        readonly: false,
        order: 12
      },
      lowpower_preset: {
        title: "low power preset",
        type: "value",
        value: 0,
        readonly: false,
        order: 13
      },
      optimal_preset: {
        title: "optimal power preset",
        type: "value",
        value: 0,
        readonly: false,
        order: 14
      },
      schedule_mode: {
        title: "schedule mode",
        type: "text",
        value: "disabled",
        readonly: false,
        enum: {
          "disabled": { en: "Disabled", ru: "Отключено" },
          "peak-offpeak-night": { en: "Peak / Off-Peak / Night", ru: "Пик / Полупик / Ночь" }
        },
        order: 20
      },
      pcb_1_inlet: {
        title: "pcb 1 inlet",
        type: "value",
        value: 0,
        readonly: true,
        order: 31
      },
      pcb_1_outlet: {
        title: "pcb 1 outlet",
        type: "value",
        value: 0,
        readonly: true,
        order: 32
      },
      pcb_1_min_temp: {
        title: "pcb 1 min temp",
        type: "value",
        value: 0,
        readonly: true,
        order: 33
      },
      pcb_1_max_temp: {
        title: "pcb 1 max temp",
        type: "value",
        value: 0,
        readonly: true,
        order: 34
      },
      pcb_2_inlet: {
        title: "pcb 2 inlet",
        type: "value",
        value: 0,
        readonly: true,
        order: 41
      },
      pcb_2_outlet: {
        title: "pcb 2 outlet",
        type: "value",
        value: 0,
        readonly: true,
        order: 42
      },
      pcb_2_min_temp: {
        title: "pcb 2 min temp",
        type: "value",
        value: 0,
        readonly: true,
        order: 43
      },
      pcb_2_max_temp: {
        title: "pcb 2 max temp",
        type: "value",
        value: 0,
        readonly: true,
        order: 44
      },
      pcb_3_inlet: {
        title: "pcb 3 inlet",
        type: "value",
        value: 0,
        readonly: true,
        order: 51
      },
      pcb_3_outlet: {
        title: "pcb 3 outlet",
        type: "value",
        value: 0,
        readonly: true,
        order: 52
      },
      pcb_3_min_temp: {
        title: "pcb 3 min temp",
        type: "value",
        value: 0,
        readonly: true,
        order: 53
      },
      pcb_3_max_temp: {
        title: "pcb 3 max temp",
        type: "value",
        value: 0,
        readonly: true,
        order: 54
      }
    }
  });

  var enabledTopicName = deviceName + "/enabled";
  var stateTopicName = deviceName + "/state";
  var currentPresetTopicName = deviceName + "/current_preset";
  var powerTopicName = deviceName + "/power";
  var apikeyTopicName = deviceName + "/apikey";

  var startMiningTopicName = deviceName + "/start_mining";
  var stopMiningTopicName = deviceName + "/stop_mining";
  var pauseMiningTopicName = deviceName + "/pause_mining";
  var resumeMiningTopicName = deviceName + "/resume_mining";
  var restartMiningTopicName = deviceName + "/restart_mining";

  var selectedPresetTopicName = deviceName + "/selected_preset";
  var performancePresetTopicName = deviceName + "/performance_preset";
  var lowpowerPresetTopicName = deviceName + "/lowpower_preset";
  var optimalPresetTopicName = deviceName + "/optimal_preset";

  var scheduleModeTopicName = deviceName + "/schedule_mode";

  var intervalId = null;
  var intervalRunning = false;

  defineRule("vnish-enabled-automation-" + deviceName, {
    whenChanged: [
      enabledTopicName
    ],
    then: function (newValue) {
      if (intervalId != null) {
        clearInterval(intervalId);
        intervalId = null;
        intervalRunning = false;
      }
      if (newValue) {
        // Инициализация пресета по расписанию при старте
        applySchedulePreset(deviceName, scheduleModeTopicName, selectedPresetTopicName);

        intervalId = setInterval(
          function () {
            if (intervalRunning) return;
            intervalRunning = true;

            getSummary(
              hostName,
              function (newState, newPower) {
                if (newState != dev[stateTopicName]) {
                  dev[stateTopicName] = newState;
                }
                if (newPower != dev[powerTopicName]) {
                  dev[powerTopicName] = newPower;
                }
              }
            );
            getPerfSummary(
              hostName,
              function (newPreset) {
                if (newPreset != dev[currentPresetTopicName]) {
                  dev[currentPresetTopicName] = newPreset;
                }
              }
            );
            getChains(
              hostName,
              function (newTemps) {
                [1, 2, 3].forEach(function (id) {
                  var data = newTemps[id];
                  var topicMin = deviceName + "/pcb_" + id + "_min_temp";
                  var topicMax = deviceName + "/pcb_" + id + "_max_temp";
                  var topicInlet = deviceName + "/pcb_" + id + "_inlet";
                  var topicOutlet = deviceName + "/pcb_" + id + "_outlet";

                  if (data) {
                    dev[topicMin] = (data.min !== undefined && data.min !== null) ? data.min : -1;
                    dev[topicMax] = (data.max !== undefined && data.max !== null) ? data.max : -1;
                    dev[topicInlet] = (data.inlet !== undefined && data.inlet !== null) ? data.inlet : -1;
                    dev[topicOutlet] = (data.outlet !== undefined && data.outlet !== null) ? data.outlet : -1;
                  } else {
                    dev[topicMin] = -1;
                    dev[topicMax] = -1;
                    dev[topicInlet] = -1;
                    dev[topicOutlet] = -1;
                  }
                });
                intervalRunning = false;
              }
            );
          },
          timeframe
        );
      }
    }
  });

  defineRule("vnish-presets-automation-" + deviceName, {
    whenChanged: [
      selectedPresetTopicName,
      performancePresetTopicName,
      lowpowerPresetTopicName,
      optimalPresetTopicName
    ],
    then: function () {
      var selectedPreset = dev[selectedPresetTopicName];
      var targetPresetValue = null;

      // 1. Определяем целевой пресет
      if (selectedPreset == "optimal") targetPresetValue = dev[optimalPresetTopicName];
      else if (selectedPreset == "performance") targetPresetValue = dev[performancePresetTopicName];
      else if (selectedPreset == "lowpower") targetPresetValue = dev[lowpowerPresetTopicName];

      if (targetPresetValue === null || targetPresetValue === undefined) return;

      var target = targetPresetValue.toString();
      var currentState = (dev[stateTopicName] || "").toString().toLowerCase();
      var currentPreset = (dev[currentPresetTopicName] || "").toString();

      // 2. Если цель "0" — останавливаем майнинг (если он еще не остановлен)
      if (target === "0") {
        var activeStates = ["mining", "starting", "auto-tuning", "initializing", "restarting"];
        if (activeStates.indexOf(currentState) !== -1) {
          log("{}: Stopping. Target is 0.", deviceName);
          postMiningStop(hostName, dev[apikeyTopicName], function (res) { });
        }
        return;
      }

      // 3. Если аппарат в состоянии ошибки — НИЧЕГО не делаем
      if (currentState === "failure") {
        log("{}: Logic blocked. Device is in FAILURE state.", deviceName);
        return;
      }

      // 4. Если аппарат остановлен — пробуем запустить
      if (currentState === "stopped" || currentState === "shutting-down") {
        log("{}: Device is stopped. Sending Start.", deviceName);
        postMiningStart(hostName, dev[apikeyTopicName], function (res) {
          // После старта проверяем, нужно ли обновить пресет
          if (currentPreset !== target) {
            log("{}: Updating preset to {} after start.", deviceName, target);
            postUpdatePerformancePreset(hostName, dev[apikeyTopicName], target, function (res) { });
          }
        });
      }
      // 5. Если уже работает — только обновляем пресет, если он отличается
      else if (currentPreset !== target) {
        log("{}: Updating preset to {}. Current is {}.", deviceName, target, currentPreset);
        postUpdatePerformancePreset(hostName, dev[apikeyTopicName], target, function (res) { });
      }
    }
  });

  defineRule("vnish-schedule-mode-changed-" + deviceName, {
    whenChanged: [
      scheduleModeTopicName
    ],
    then: function () {
      applySchedulePreset(deviceName, scheduleModeTopicName, selectedPresetTopicName);
    }
  });

  defineRule("vnish-turn-night-preset-" + deviceName, {
    when: cron("0 0 23 * * *"),
    then: function () {
      var scheduleMode = dev[scheduleModeTopicName];
      if (scheduleMode == "peak-offpeak-night") {
        dev[selectedPresetTopicName] = "performance";
      }
    }
  });

  defineRule("vnish-turn-peak-preset-" + deviceName, {
    when: cron("0 0 7 * * *"),
    then: function () {
      var scheduleMode = dev[scheduleModeTopicName];
      if (scheduleMode == "peak-offpeak-night") {
        dev[selectedPresetTopicName] = "lowpower";
      }
    }
  });

  defineRule("vnish-turn-offpeak-preset-" + deviceName, {
    when: cron("0 0 10 * * *"),
    then: function () {
      var scheduleMode = dev[scheduleModeTopicName];
      if (scheduleMode == "peak-offpeak-night") {
        dev[selectedPresetTopicName] = "optimal";
      }
    }
  });

  defineRule("vnish-turn-peak2-preset-" + deviceName, {
    when: cron("0 0 17 * * *"),
    then: function () {
      var scheduleMode = dev[scheduleModeTopicName];
      if (scheduleMode == "peak-offpeak-night") {
        dev[selectedPresetTopicName] = "lowpower";
      }
    }
  });

  defineRule("vnish-turn-offpeak2-preset-" + deviceName, {
    when: cron("0 0 21 * * *"),
    then: function () {
      var scheduleMode = dev[scheduleModeTopicName];
      if (scheduleMode == "peak-offpeak-night") {
        dev[selectedPresetTopicName] = "optimal";
      }
    }
  });

  defineRule("vnish-start-button-automation-" + deviceName, {
    whenChanged: [
      startMiningTopicName
    ],
    then: function () {
      postMiningStart(
        hostName,
        dev[apikeyTopicName],
        function (value) {
          var message = '{}: mining start with {}'.format(
            deviceName,
            value
          );
          log(message);
        }
      );
    }
  });

  defineRule("vnish-stop-button-automation-" + deviceName, {
    whenChanged: [
      stopMiningTopicName
    ],
    then: function () {
      postMiningStop(
        hostName,
        dev[apikeyTopicName],
        function (value) {
          var message = '{}: mining stop with {}'.format(
            deviceName,
            value
          );
          log(message);
        }
      );
    }
  });

  defineRule("vnish-restart-button-automation-" + deviceName, {
    whenChanged: [
      restartMiningTopicName
    ],
    then: function () {
      postMiningRestart(
        hostName,
        dev[apikeyTopicName],
        function (value) {
          var message = '{}: mining restart with {}'.format(
            deviceName,
            value
          );
          log(message);
        }
      );
    }
  });

  defineRule("vnish-resume-button-automation-" + deviceName, {
    whenChanged: [
      resumeMiningTopicName
    ],
    then: function () {
      postMiningResume(
        hostName,
        dev[apikeyTopicName],
        function (value) {
          var message = '{}: mining resume with {}'.format(
            deviceName,
            value
          );
          log(message);
        }
      );
    }
  });

  defineRule("vnish-pause-button-automation-" + deviceName, {
    whenChanged: [
      pauseMiningTopicName
    ],
    then: function () {
      postMiningPause(
        hostName,
        dev[apikeyTopicName],
        function (value) {
          var message = '{}: mining pause with {}'.format(
            deviceName,
            value
          );
          log(message);
        }
      );
    }
  });
}

buildVNISHDevice(
  "ANTMINER S21e",
  "http://192.168.0.111",
  5000
);
