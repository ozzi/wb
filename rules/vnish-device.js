function performGET(
  host,
  endpoint,
  callback
) {
  var command = 'curl -s --connect-timeout 1 --max-time 1 -X GET {}{}'.format(
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
  "https://t21-one.outzzz.keenetic.pro",
  5000
);

buildVNISHDevice(
  "ANTMINER T21-2",
  "https://t21-two.outzzz.keenetic.pro",
  5000
);