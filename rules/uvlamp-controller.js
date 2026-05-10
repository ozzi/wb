// Version: 1

function updateLampState(state, lampVD, filterTopic) {
    var mode = dev[lampVD]["mode"];
    var filterOn = dev[filterTopic] == 1; // Проверяем, что фильтр включен (значение "1")

    var shouldBeOn = false;
    if (mode == 1) {
        shouldBeOn = filterOn;
    } else if (mode == 2) {
        shouldBeOn = true;
    }

    var isActive = state.lampActive;

    if (shouldBeOn !== isActive) {
        var now = Date.now();

        if (shouldBeOn) {
            // Включаем лампу
            state.lampActive = true;
            state.lastUpdate = now;
            dev[lampVD]["enabled"] = true;
        } else {
            // Выключаем лампу
            state.lampActive = false;

            // Обновляем счетчик времени
            if (state.lastUpdate > 0) {
                var deltaHours = (now - state.lastUpdate) / 3600000;
                dev[lampVD]["work_hours"] += deltaHours;
                state.lastUpdate = 0;
                checkLampResource(lampVD);
            }

            dev[lampVD]["enabled"] = false;
        }
    }
}

function updateCounter(state, lampVD) {
    if (!state.lampActive) return;

    var now = Date.now();
    var deltaHours = (now - state.lastUpdate) / 3600000;
    state.lastUpdate = now;
    dev[lampVD]["work_hours"] += deltaHours;
    checkLampResource(lampVD);
}

function checkLampResource(lampVD) {
    var totalHours = dev[lampVD]["work_hours"] || 0;
    var resource = dev[lampVD]["lamp_resource"] || 8000;

    dev[lampVD]["replace_soon"] = totalHours >= resource * 0.9;
    dev[lampVD]["replace_now"] = totalHours >= resource;
}

function setupUVLampControl(lampVD, filterTopic, lampSwitchControl) {
    defineVirtualDevice(lampVD, {
        title: "UV Lamp - " + lampVD,
        cells: {
            mode: {
                type: "value",
                value: 1,
                enum: {
                    1: { en: 'Auto', ru: 'Авто' },
                    2: { en: 'On', ru: 'Включено' },
                    3: { en: 'Off', ru: 'Выключено' }
                },
                name: "Режим работы",
                readonly: false,
                order: 1
            },
            enabled: {
                type: "switch",
                value: false,
                readonly: true,
                name: "Состояние лампы",
                order: 2
            },
            work_hours: {
                type: "value",
                value: 0,
                readonly: true,
                name: "Наработка (часы)",
                order: 3
            },
            lamp_resource: {
                type: "value",
                value: 8000,
                name: "Ресурс лампы (часы)",
                order: 4
            },
            replace_soon: {
                type: "switch",
                value: false,
                readonly: true,
                name: "Замена скоро (90%)",
                order: 5
            },
            replace_now: {
                type: "switch",
                value: false,
                readonly: true,
                name: "Требуется замена",
                order: 6
            },
            reset_counter: {
                type: "pushbutton",
                name: "Сброс наработки",
                order: 7
            }
        }
    });

    var state = {
        lampActive: false,
        lastUpdate: 0
    };

    // Изменение режима работы
    var modeChangeTopicName = lampVD + "/mode";
    defineRule("modeChange_" + lampVD, {
        whenChanged: [
            modeChangeTopicName
        ],
        then: function () {
            updateLampState(state, lampVD, filterTopic);
        }
    });

    // Изменение состояния фильтра
    defineRule("filterChange_" + lampVD, {
        whenChanged: [
            filterTopic
        ],
        then: function () {
            if (dev[lampVD]["mode"] == 1) {
                updateLampState(state, lampVD, filterTopic);
            }
        }
    });

    // Изменение состояния фильтра
    var enabledTopicName = lampVD + "/enabled";
    defineRule("enabledChange_" + lampVD, {
        whenChanged: [
            enabledTopicName
        ],
        then: function (newValue) {
            dev[lampSwitchControl] = newValue;
        }
    });

    // Периодическое обновление счетчика (каждую минуту)
    defineRule("updateCounter_" + lampVD, {
        when: cron("@every 1m"),
        then: function () {
            updateCounter(state, lampVD);
        }
    });

    // Сброс счетчика
    var resetCounterTopicName = lampVD + "/reset_counter";
    defineRule("resetCounter_" + lampVD, {
        whenChanged: [
            resetCounterTopicName
        ],
        then: function () {
            if (dev[lampVD]["reset_counter"]) {
                // Если лампа активна, фиксируем текущее время
                if (state.lampActive) {
                    var now = Date.now();
                    var deltaHours = (now - state.lastUpdate) / 3600000;
                    dev[lampVD]["work_hours"] += deltaHours;
                    state.lastUpdate = now;
                }

                // Сбрасываем счетчик
                dev[lampVD]["work_hours"] = 0;
                dev[lampVD]["replace_soon"] = false;
                dev[lampVD]["replace_now"] = false;
                dev[lampVD]["reset_counter"] = false;

                checkLampResource(lampVD);
            }
        }
    });

    // Изменение ресурса лампы
    var lampResourceTopicName = lampVD + "/lamp_resource";
    defineRule("resourceChange_" + lampVD, {
        whenChanged: [
            lampResourceTopicName
        ],
        then: function () {
            checkLampResource(lampVD);
        }
    });
}

setupUVLampControl("uv-lamp-control", "pool-filtration-ctrl-outdoor/mode", "wb-mr6cu_91/K5");
