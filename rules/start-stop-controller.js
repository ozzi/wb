function startStopController(
    name,
    valueTopicName,
    switchTopicName
) {
    var deviceName = "start-stop-controller-" + name;
    defineVirtualDevice(deviceName, {
        title: "Start Stop Controller - " + name,
        cells: {
            enabled: {
                title: "enabled",
                type: "switch",
                value: false,
                readonly: false,
                order: 0
            },
            start: {
                title: "Start value",
                type: "value",
                value: 0,
                readonly: false,
                order: 1
            },
            stop: {
                title: "Stop value",
                type: "value",
                value: 0,
                readonly: false,
                order: 2
            }
        }
    });

    var enabledTopicName = deviceName + "/enabled";
    var startTopicName = deviceName + "/start";
    var stopTopicName = deviceName + "/stop";

    defineRule("start-stop-automation-" + name, {
        whenChanged: [
            valueTopicName,
            enabledTopicName,
            startTopicName,
            stopTopicName
        ],
        then: function (newValue, devName, cellName) {
            var enabled = dev[enabledTopicName];
            var startValue = dev[startTopicName];
            var stopValue = dev[stopTopicName];
            var value = dev[valueTopicName];
            if (enabled == false) {
                dev[switchTopicName] = false;
            } else if (value < startValue) {
                dev[switchTopicName] = true;
            } else if (value > stopValue) {
                dev[switchTopicName] = false;
            }
        }
    });
}


startStopController(
    "well-cooling",
    "pressure-controller-hyd-accum/pressureValue",
    "wb-mr6cu_91/K6"
);