function makeTankLevelController(
    name,
    bottomSensorTopic,
    middleSensorTopic,
    topSensorTopic,
    valveRelayTopic
) {
    var deviceName = "tank-level-" + name;
    var debounceTimer = null;

    defineVirtualDevice(deviceName, {
        title: "Tank Level Controller - " + name,
        cells: {
            status: {
                type: "text",
                readonly: true,
                value: "empty"
            },
            filling: {
                type: "switch",
                readonly: true,
                value: false
            },
            invert_sensors: {
                type: "switch",
                value: false
            },
            debounce_sec: {
                type: "value",
                value: 10
            },
            auto_mode: {
                type: "switch",
                value: true
            },
            fill_now: {
                type: "pushbutton"
            },
            force_fill: {
                type: "switch",
                readonly: true,
                value: false
            }
        }
    });

    function getSensorState(topic) {
        var raw = !!dev[topic];
        var invert = !!dev[deviceName]["invert_sensors"];
        return invert ? !raw : raw;
    }

    function evaluateAndApply() {
        var bottom = getSensorState(bottomSensorTopic);
        var middle = getSensorState(middleSensorTopic);
        var top = getSensorState(topSensorTopic);

        var autoMode = !!dev[deviceName]["auto_mode"];
        var forceFill = !!dev[deviceName]["force_fill"];

        var newStatus = "empty";
        var isError = false;

        // Проверка консистентности датчиков
        if (top && (!middle || !bottom)) {
            isError = true;
        } else if (middle && !bottom) {
            isError = true;
        }

        if (isError) {
            newStatus = "error";
        } else if (top && middle && bottom) {
            newStatus = "full";
        } else if (middle && bottom) {
            newStatus = "medium";
        } else if (bottom) {
            newStatus = "low";
        } else {
            newStatus = "empty";
        }

        dev[deviceName]["status"] = newStatus;

        // Логика управления клапаном
        var shouldFill = false;

        if (isError) {
            shouldFill = false;
            forceFill = false;
        } else if (newStatus === "full") {
            shouldFill = false;
            forceFill = false;
        } else {
            var autoFill = autoMode && (!middle && !top);
            shouldFill = autoFill || forceFill;
        }

        if (dev[deviceName]["force_fill"] !== forceFill) {
            dev[deviceName]["force_fill"] = forceFill;
        }

        var currentFilling = !!dev[deviceName]["filling"];
        if (shouldFill !== currentFilling) {
            dev[deviceName]["filling"] = shouldFill;
            dev[valveRelayTopic] = shouldFill;
        } else {
            // Синхронизация реле на случай внешнего вмешательства
            if (dev[valveRelayTopic] !== shouldFill) {
                dev[valveRelayTopic] = shouldFill;
            }
        }
    }

    function scheduleEvaluation() {
        if (debounceTimer !== null) {
            clearTimeout(debounceTimer);
        }
        var delay = parseInt(dev[deviceName]["debounce_sec"], 10) || 0;
        if (delay > 0) {
            debounceTimer = setTimeout(function() {
                debounceTimer = null;
                evaluateAndApply();
            }, delay * 1000);
        } else {
            evaluateAndApply();
        }
    }

    defineRule({
        whenChanged: [
            bottomSensorTopic,
            middleSensorTopic,
            topSensorTopic,
            deviceName + "/invert_sensors",
            deviceName + "/debounce_sec",
            deviceName + "/auto_mode"
        ],
        then: function() {
            scheduleEvaluation();
        }
    });

    defineRule({
        whenChanged: [
            deviceName + "/fill_now"
        ],
        then: function() {
            dev[deviceName]["force_fill"] = true;
            scheduleEvaluation();
        }
    });

    // Первоначальное вычисление состояния при старте правила
    evaluateAndApply();
}

makeTankLevelController(
    "main",
    "wb-mr6cv3_52/Input 1",
    "wb-mr6cv3_52/Input 2",
    "wb-mr6cv3_52/Input 3",
    "wb-mr6cv3_52/K2"
);
