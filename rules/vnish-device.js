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
  var command = 'curl -X POST {}{} -H \'x-api-key: {}\''.format(
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
  var command = 'curl -X POST {}{} -H \'x-api-key: {}\' -H \'Content-Type: application/json\' -d \'{}\''.format(
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


function getSummary(host, callback) {
  performGET(
    host,
    "/api/v1/summary",
    function (serverResponse) {
      if (serverResponse == null) {
        callback("unavailable", 0);
      } else {
        var response = JSON.parse(serverResponse);
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
        var response = JSON.parse(serverResponse);
        var presetStr = response["current_preset"]["name"];
        var preset = parseInt(presetStr);
        callback(preset);
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
          "performance": { en: "Performance", ru: "Производительный" },
          "pool": { en: "Pool", ru: "Бассейн" }
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
      pool_preset: {
        title: "pool preset",
        type: "value",
        value: 3480,
        readonly: false,
        order: 15
      },
      schedule_mode: {
        title: "schedule mode",
        type: "text",
        value: "disabled",
        readonly: false,
        enum: {
          "disabled": { en: "Disabled", ru: "Отключено" },
          "day-night": { en: "Day / Night", ru: "День / Ночь" },
          "pool-heat": { en: "Pool heat", ru: "Обогрев бассейна" },
          "peak-offpeak-night": { en: "Peak / Off-Peak / Night", ru: "Пик / Полупик / Ночь" }
        },
        order: 20
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
  var poolPresetTopicName = deviceName + "/pool_preset";

  var scheduleModeTopicName = deviceName + "/schedule_mode";

  var intervalId = null;

  defineRule("vnish-enabled-automation-" + deviceName, {
    whenChanged: [
      enabledTopicName
    ],
    then: function (newValue) {
      if (intervalId != null) {
        clearInterval(intervalId);
      }
      if (newValue) {
        intervalId = setInterval(
          function () {
            getSummary(
              hostName,
              function(newState, newPower) {
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
              function(newPreset) {
                if (newPreset != dev[currentPresetTopicName]) {
                  dev[currentPresetTopicName] = newPreset;
                }
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
      optimalPresetTopicName,
      poolPresetTopicName
    ],
    then: function () {
      var selectedPreset = dev[selectedPresetTopicName];
      var performancePreset = dev[performancePresetTopicName];
      var lowpowerPreset = dev[lowpowerPresetTopicName];
      var optimalPreset = dev[optimalPresetTopicName];
      var poolPreset = dev[poolPresetTopicName];
      var currentPreset = dev[currentPresetTopicName];
      var newPreset = currentPreset;
      if (selectedPreset == "optimal") {
        newPreset = optimalPreset;
      } else if (selectedPreset == "performance") {
        newPreset = performancePreset;
      } else if (selectedPreset == "lowpower") {
        newPreset = lowpowerPreset;
      } else if (selectedPreset == "pool") {
        newPreset = poolPreset;
      }
      
      if (currentPreset != newPreset) {
        postUpdatePerformancePreset(
          hostName,
          dev[apikeyTopicName],
          newPreset,
          function() {
            var message = '{}: change preset to {}'.format(
              deviceName,
              newPreset
            );
            log(message);
          }
        );
      }
    }
  });

  defineRule("vnish-schedule-mode-changed" + deviceName, {
    whenChanged: [
      scheduleModeTopicName
    ],
    then: function () {
      var scheduleMode = dev[scheduleModeTopicName];
      if (scheduleMode == "day-night") {
        if (isNightRate()) {
          dev[selectedPresetTopicName] = "performance";
        } else {
          dev[selectedPresetTopicName] = "lowpower";
        }
      } else if (scheduleMode == "peak-offpeak-night") {
        if (isNightRate()) {
          dev[selectedPresetTopicName] = "performance";
        } else if (isPeakRate()) {
          dev[selectedPresetTopicName] = "lowpower";
        } else {
          dev[selectedPresetTopicName] = "optimal";
        }
      } else if (scheduleMode == "pool-heat") {
        dev[selectedPresetTopicName] = "pool";
      }
    }
  });

  defineRule("vnish-turn-night-preset" + deviceName, {
    when: cron("00 00 23 * *"),
    then: function () {
      var scheduleMode = dev[scheduleModeTopicName];
      if (scheduleMode == "day-night" || scheduleMode == "peak-offpeak-night") {
        dev[selectedPresetTopicName] = "performance";
      }
    }
  });

  defineRule("vnish-turn-peak-preset" + deviceName, {
    when: cron("00 00 07 * *"),
    then: function () {
      var scheduleMode = dev[scheduleModeTopicName];
      if (scheduleMode == "day-night" || scheduleMode == "peak-offpeak-night") {
        dev[selectedPresetTopicName] = "lowpower";
      }
    }
  });

  defineRule("vnish-turn-offpeak-preset" + deviceName, {
    when: cron("00 00 10 * *"),
    then: function () {
      var scheduleMode = dev[scheduleModeTopicName];
      if (scheduleMode == "peak-offpeak-night") {
        dev[selectedPresetTopicName] = "optimal";
      }
    }
  });

  defineRule("vnish-turn-peak2-preset" + deviceName, {
    when: cron("00 00 17 * *"),
    then: function () {
      var scheduleMode = dev[scheduleModeTopicName];
      if (scheduleMode == "peak-offpeak-night") {
        dev[selectedPresetTopicName] = "lowpower";
      }
    }
  });

  defineRule("vnish-turn-offpeak2-preset" + deviceName, {
    when: cron("00 00 21 * *"),
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
        function(value) {
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
        function(value) {
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
        function(value) {
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
        function(value) {
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
        function(value) {
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
  "ANTMINER T21-1",
  "http://192.168.0.52",
  5000
);

buildVNISHDevice(
  "ANTMINER T21-2",
  "http://192.168.0.53",
  5000
);