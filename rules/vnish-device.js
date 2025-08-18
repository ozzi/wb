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
      state: {
        title: "miner state",
        type: "text",
        value: "",
        readonly: true,
        order: 2
      },
      current_preset: {
        title: "current preset",
        type: "value",
        value: 0,
        readonly: true,
        order: 3
      },
      power: {
        title: "current power",
        type: "value",
        value: 0,
        readonly: true,
        order: 4
      }
    }
  });

  var enabledTopicName = deviceName + "/enabled";
  var stateTopicName = deviceName + "/state";
  var currentPresetTopicName = deviceName + "/current_preset";
  var powerTopicName = deviceName + "/power";

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