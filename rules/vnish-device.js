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

function getStatus(host, callback) {
  performGET(
    host,
    "/api/v1/status",
    function (serverResponse) {
      if (serverResponse == null) {
        callback(null);
      } else {
        var response = JSON.parse(serverResponse);
        callback(response["miner_state"]);
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
        callback(null);
      } else {
        var response = JSON.parse(serverResponse);
        callback(response["current_preset"]["name"]);
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
      }
    }
  });

  var enabledTopicName = deviceName + "/enabled";
  var stateTopicName = deviceName + "/state";
  var currentPresetTopicName = deviceName + "/current_preset";

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
            getStatus(
              hostName,
              function(state) {
                var currentState = dev[stateTopicName];
                var newState = "unavailable";
                if (state != null) {
                  newState = state;
                }
                if (currentState != newState) {
                  dev[stateTopicName] = newState;
                }
              }
            );
            getPerfSummary(
              hostName,
              function(preset) {
                var currentPreset = dev[currentPresetTopicName];
                var newPreset = 0;
                if (preset != null) {
                  newPreset = parseInt(preset);
                }
                if (currentPreset != newPreset) {
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