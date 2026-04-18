function arrayToString(arr) {
    return arr
        .filter(function (item) {
            // Проверяем, что элемент - массив из двух элементов (не null и длина = 2)
            return Array.isArray(item) && item.length === 2;
        })
        .map(function (pair) {
            // Преобразуем каждый массив в строку 'a-b'
            return pair[0] + '-' + pair[1];
        })
        .join(','); // Объединяем все строки через запятую
}

// Преобразование времени в минуты
function toMinutes(timeStr) {
    var parts = timeStr.split(':');
    var hours = parseInt(parts[0], 10);
    var minutes = parseInt(parts[1], 10);
    return hours * 60 + minutes;
}

// Форматирование минут в строку HH:MM
function toTimeStr(totalMinutes) {
    // Нормализация времени (включая отрицательные значения и >24 часов)
    totalMinutes = ((totalMinutes % 1440) + 1440) % 1440;
    var hours = Math.floor(totalMinutes / 60) % 24;
    var minutes = Math.floor(totalMinutes % 60);
    return (hours < 10 ? '0' : '') + hours + ':' + (minutes < 10 ? '0' : '') + minutes;
}

// Проверка формата времени HH:MM
function isValidTimeStr(timeStr) {
    if (typeof timeStr !== 'string') { return false; }
    var re = /^\d{2}:\d{2}$/;
    if (!re.test(timeStr)) { return false; }
    var parts = timeStr.split(':');
    var hours = parseInt(parts[0], 10);
    var minutes = parseInt(parts[1], 10);
    return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function optimizedSchedule(windows) {
    var result = [null, null, null, null];
    if (windows[0] > 0) {
        var morningTime = toMinutes("09:00");
        var morningStart = Math.round(morningTime - windows[0]/2);
        var morningEnd = Math.round(morningTime + windows[0]/2);
        result[0] = [toTimeStr(morningStart), toTimeStr(morningEnd)];
    }

    if (windows[1] > 0) {
        var dayTime = toMinutes("15:00");
        var dayStart = Math.round(dayTime - windows[1]/2);
        var dayEnd = Math.round(dayTime + windows[1]/2);
        result[1] = [toTimeStr(dayStart), toTimeStr(dayEnd)];
    }

    if (windows[2] > 0) {
        var eveningTime = toMinutes("21:00");
        var eveningStart = Math.round(eveningTime - windows[2]/2);
        var eveningEnd = Math.round(eveningTime + windows[2]/2);
        result[2] = [toTimeStr(eveningStart), toTimeStr(eveningEnd)];
    }

    if (windows[3] > 0) {
        var nightTime = toMinutes("03:00");
        var nightStart = Math.round(nightTime - windows[3]/2);
        var nightEnd = Math.round(nightTime + windows[3]/2);
        result[3] = [toTimeStr(nightStart), toTimeStr(nightEnd)];
    }
    return result;
}

function schedule(sunriseStr, sunsetStr, windows) {
    var sunRise = toMinutes(sunriseStr);
    var sunSet = toMinutes(sunsetStr);
    var result = [null, null, null, null]; // [утро, день, вечер, ночь]

    // Утреннее окно (0): начинается сразу после рассвета
    if (windows[0] > 0) {
        var morningStart = sunRise;
        var morningEnd = morningStart + windows[0];
        result[0] = [toTimeStr(morningStart), toTimeStr(morningEnd)];
    }

    // Дневное окно (1): середина между рассветом и закатом
    if (windows[1] > 0) {
        var midday = sunRise + (sunSet - sunRise) / 2;
        var dayStart = Math.round(midday - windows[1] / 2);
        var dayEnd = Math.round(midday + windows[1] / 2);
        result[1] = [toTimeStr(dayStart), toTimeStr(dayEnd)];
    }

    // Вечернее окно (2): завершается перед закатом
    if (windows[2] > 0) {
        var eveningEnd = sunSet;
        var eveningStart = eveningEnd - windows[2];
        result[2] = [toTimeStr(eveningStart), toTimeStr(eveningEnd)];
    }

    // Ночное окно (3): середина между закатом и рассветом
    if (windows[3] > 0) {
        // Рассвет следующего дня (sunRise + 24 часа)
        var nextSunrise = sunRise + 1440;
        var nightMid = sunSet + (nextSunrise - sunSet) / 2;
        var nightStart = Math.round(nightMid - windows[3] / 2);
        var nightEnd = Math.round(nightMid + windows[3] / 2);
        result[3] = [toTimeStr(nightStart), toTimeStr(nightEnd)];
    }

    return result;
}

function makePoolFiltrationController(
    name,
    pumpSwitchTopicName,
    flowSensorTopicName,
    timeframe
) {
    var deviceName = "pool-filtration-ctrl-" + name;
    defineVirtualDevice(deviceName, {
        title: "Pool Filtration Controller - " + name,
        cells: {
            daily_cycles: {
                type: "value",
                readonly: true,
                value: 0
            },
            total_filtration_volume: {
                type: "value",
                unit: "л",
                readonly: true,
                value: 0
            },
            filtration_rate: {
                type: "value",
                unit: "м3/ч",
                readonly: true,
                value: 0
            },
            filtration_speed: {
                type: "value",
                unit: "м3/ч/м2",
                readonly: true,
                value: 0
            },
            filter_diameter: {
                type: "value",
                unit: "мм",
                readonly: false,
                value: 450
            },
            pool_volume: {
                type: "value",
                unit: "л",
                readonly: false,
                value: 28000
            },
            pump_flow_rate: {
                type: "value",
                unit: "м3/ч",
                readonly: false,
                value: 13
            },
            set_daily_cycles: {
                type: "range",
                value: 1,
                max: 8,
                min: 1,
                readonly: false,
            },
            work_hours_per_day: {
                type: "value",
                readonly: true,
                value: 1
            },
            day_weight: {
                type: "range",
                value: 1,
                max: 5,
                min: 0,
                readonly: false,
            },
            night_weight: {
                type: "range",
                value: 1,
                max: 5,
                min: 0,
                readonly: false,
            },
            morning_weight: {
                type: "range",
                value: 1,
                max: 5,
                min: 0,
                readonly: false,
            },
            evening_weight: {
                type: "range",
                value: 1,
                max: 5,
                min: 0,
                readonly: false,
            },
            calc_pool_volume_filtration_time: {
                type: "value",
                unit: "м3/ч",
                readonly: true,
                value: 0
            },
            calc_filtration_speed: {
                type: "value",
                unit: "м3/ч/м2",
                readonly: true,
                value: 0
            },
            sunrise_time: {
                type: "text",
                readonly: false,
                value: "05:30"
            },
            sunset_time: {
                type: "text",
                readonly: false,
                value: "20:00"
            },
            schedule: {
                type: "text",
                readonly: true,
                value: ""
            },
            mode: {
                title: "mode",
                type: "value",
                value: 0,
                readonly: false,
                enum: {
                    0: { en: "Off", ru: "Выключено" },
                    1: { en: "Filtration", ru: "Фильтрация" },
                    2: { en: "Backwash", ru: "Обратная промывка" }
                }
            },
            schedule_type: {
                title: "schedule type",
                type: "value",
                value: 0,
                readonly: false,
                enum: {
                    0: { en: "Sunrise-Sunset", ru: "Рассвет-Закат" },
                    1: { en: "Optimized", ru: "Оптимизированный" }
                }
            },
            schedule_mode: {
                title: "schedule mode",
                type: "value",
                value: 0,
                readonly: false,
                enum: {
                    0: { en: "Manual", ru: "Вручную" },
                    1: { en: "On schedule", ru: "По заданному расписанию" }
                }
            }
        }
    });

    var dailyCyclesTopicName = deviceName + "/daily_cycles";
    var totalVolumeTopicName = deviceName + "/total_filtration_volume";
    var filtrationRateTopicName = deviceName + "/filtration_rate";
    var filtrationSpeedTopicName = deviceName + "/filtration_speed";
    var filterDiameterTopicName = deviceName + "/filter_diameter";
    var poolVolumeTopicName = deviceName + "/pool_volume";
    var modeTopicName = deviceName + "/mode";
    var pumpFlowRateTopicName = deviceName + "/pump_flow_rate";
    var setDailyCyclesTopicName = deviceName + "/set_daily_cycles";
    var workHoursPerDayTopicName = deviceName + "/work_hours_per_day";
    var dayWeightTopicName = deviceName + "/day_weight";
    var nightWeightTopicName = deviceName + "/night_weight";
    var morningWeightTopicName = deviceName + "/morning_weight";
    var eveningWeightTopicName = deviceName + "/evening_weight";

    var scheduleTopicName = deviceName + "/schedule";
    var scheduleModeTopicName = deviceName + "/schedule_mode";
    var scheduleTypeTopicName = deviceName + "/schedule_type";

    var sunriseTimeTopicName = deviceName + "/sunrise_time";
    var sunsetTimeTopicName = deviceName + "/sunset_time";

    var calcFiltrationRateTopicName = deviceName + "/calc_pool_volume_filtration_time";
    var calcFiltrationSpeedTopicName = deviceName + "/calc_filtration_speed";


    defineRule("pool-cycles-calc-" + name, {
        whenChanged: [
            poolVolumeTopicName,
            pumpFlowRateTopicName,
            setDailyCyclesTopicName,
            dayWeightTopicName,
            nightWeightTopicName,
            morningWeightTopicName,
            eveningWeightTopicName,
            sunriseTimeTopicName,
            sunsetTimeTopicName,
            scheduleTypeTopicName
        ],
        then: function (newValue) {
            var poolVolume = dev[poolVolumeTopicName];
            var pumpFlow = dev[pumpFlowRateTopicName];
            if (pumpFlow === 0) {
                log.warning("[pool-filtration-ctrl-{}] pumpFlow is zero", name);
                return;
            }

            var filterDiameter = dev[filterDiameterTopicName];
            if (filterDiameter <= 0) {
                log.warning("[pool-filtration-ctrl-{}] filter_diameter is zero or negative", name);
                return;
            }

            var dailyCycles = dev[setDailyCyclesTopicName];
            var workHoursPerDay = poolVolume / 1000 * dailyCycles / pumpFlow;
            // Обрезаем до 24 часов ДО распределения по весам
            if (workHoursPerDay > 24) {
                workHoursPerDay = 24;
            }

            var dayWeight = dev[dayWeightTopicName];
            var nightWeight = dev[nightWeightTopicName];
            var morningWeight = dev[morningWeightTopicName];
            var eveningWeight = dev[eveningWeightTopicName];
            var totalWeight = dayWeight + nightWeight + morningWeight + eveningWeight;
            if (totalWeight === 0) {
                dev[scheduleTopicName] = "";
                dev[workHoursPerDayTopicName] = 0;
                return;
            }
            var dayHours = workHoursPerDay * dayWeight / totalWeight;
            var nightHours = workHoursPerDay * nightWeight / totalWeight;
            var morningHours = workHoursPerDay * morningWeight / totalWeight;
            var eveningHours = workHoursPerDay * eveningWeight / totalWeight;
            var scheduleType = dev[scheduleTypeTopicName];

            var times = [];

            if (scheduleType == 0) {
                var sunriseTime = dev[sunriseTimeTopicName];
                var sunsetTime = dev[sunsetTimeTopicName];
                if (!isValidTimeStr(sunriseTime)) {
                    log.warning("[pool-filtration-ctrl-{}] invalid sunrise_time: '{}'", name, sunriseTime);
                    return;
                }
                if (!isValidTimeStr(sunsetTime)) {
                    log.warning("[pool-filtration-ctrl-{}] invalid sunset_time: '{}'", name, sunsetTime);
                    return;
                }
                times = schedule(
                    sunriseTime,
                    sunsetTime,
                    [morningHours * 60, dayHours * 60, eveningHours * 60, nightHours * 60]
                );
            } else {
                times = optimizedSchedule(
                    [morningHours * 60, dayHours * 60, eveningHours * 60, nightHours * 60]
                );
            }

            var formattedTimes = arrayToString(times);

            dev[workHoursPerDayTopicName] = workHoursPerDay;
            dev[scheduleTopicName] = formattedTimes;

            dev[calcFiltrationRateTopicName] = poolVolume / 1000 / pumpFlow;
            var dia = filterDiameter / 1000;
            dev[calcFiltrationSpeedTopicName] = pumpFlow / (Math.PI * Math.pow(dia / 2, 2));
        }
    });

    defineRule("pool-flow-rate-calc-" + name, {
        whenChanged: [
            flowSensorTopicName
        ],
        then: function (newValue) {
            if (newValue < 0) {
                log.warning("[pool-filtration-ctrl-{}] flow sensor value is negative: {}", name, newValue);
                return;
            }
            var rateInM3H = newValue * 60 / 1000;
            dev[filtrationRateTopicName] = rateInM3H;
        }
    });

    defineRule("filtration-speed-calc-" + name, {
        whenChanged: [
            filtrationRateTopicName
        ],
        then: function (newValue) {
            var dia = dev[filterDiameterTopicName] / 1000;
            if (dia <= 0) {
                log.warning("[pool-filtration-ctrl-{}] filter_diameter is zero or negative", name);
                return;
            }
            var filterArea = Math.PI * Math.pow(dia / 2, 2);
            var speed = newValue / filterArea;
            dev[filtrationSpeedTopicName] = speed;
        }
    });

    var last_update = 0;

    var dailyCyclesCalc = function () {
        var newValue = dev[flowSensorTopicName];
        var now = Date.now();
        var totalVolume = dev[totalVolumeTopicName];
        if (last_update > 0) {
            var hours = (now - last_update) / (1000 * 3600);
            totalVolume += newValue * 60 * hours;
        }
        last_update = now;
        dev[totalVolumeTopicName] = totalVolume;
        var poolVolume = dev[poolVolumeTopicName];
        var cycles = totalVolume / poolVolume;
        dev[dailyCyclesTopicName] = cycles;
    };

    setInterval(dailyCyclesCalc, timeframe);

    defineRule("reset-daily-stats-" + name, {
        when: cron("00 00 00 * *"),
        then: function () {
            dev[totalVolumeTopicName] = 0;
        }
    });

    defineRule("mode-changed-" + name, {
        whenChanged: [
            modeTopicName
        ],
        then: function (newValue) {
            if (newValue == 0 || newValue == 2) {
                dev[pumpSwitchTopicName] = false;
            } else if (newValue == 1) {
                dev[pumpSwitchTopicName] = true;
            }
        }
    });

    defineRule("pump-switch-changed-" + name, {
        whenChanged: [
            pumpSwitchTopicName
        ],
        then: function (newValue) {
            var mode = dev[modeTopicName];
            if (newValue == false) {
                if (mode == 1) {
                    dev[modeTopicName] = 0;
                }
            } else if (newValue == true) {
                if (mode == 0) {
                    dev[modeTopicName] = 1;
                }
            }
        }
    });

    defineRule("filtration-schedule-" + name, {
        when: cron("@every 1m"),
        then: function () {
            var scheduleMode = dev[scheduleModeTopicName];
            if (scheduleMode != 1) { return; }
            var mode = dev[modeTopicName];
            if (mode == 2) { return; }

            var timeWindowsStr = dev[scheduleTopicName];
            if (!timeWindowsStr || timeWindowsStr === "") { return; }
            var timeWindows = timeWindowsStr.split(',');

            // Получаем текущее время
            var now = new Date();
            var hours = now.getHours();
            var minutes = now.getMinutes();
            var currentMinutes = hours * 60 + minutes;

            // Проверяем каждое временное окно
            var isInWindow = false;

            for (var i = 0; i < timeWindows.length; i++) {
                var timeWindow = timeWindows[i].split('-');
                if (!timeWindow[0] || !timeWindow[1]) { continue; }
                var startParts = timeWindow[0].split(':');
                var endParts = timeWindow[1].split(':');

                var startHours = parseInt(startParts[0], 10);
                var startMinutes = parseInt(startParts[1], 10);
                var endHours = parseInt(endParts[0], 10);
                var endMinutes = parseInt(endParts[1], 10);

                var startTotal = startHours * 60 + startMinutes;
                var endTotal = endHours * 60 + endMinutes;

                // Обработка окон, переходящих через полночь
                if (endTotal < startTotal) {
                    // Проверка для ночных окон: текущее время >= начала ИЛИ < конца
                    if (currentMinutes >= startTotal || currentMinutes < endTotal) {
                        isInWindow = true;
                        break;
                    }
                } else {
                    // Проверка для дневных окон
                    if (currentMinutes >= startTotal && currentMinutes < endTotal) {
                        isInWindow = true;
                        break;
                    }
                }
            }

            if (isInWindow) {
                if (mode != 1)  { dev[modeTopicName] = 1; }
            } else {
                if (mode != 0) { dev[modeTopicName] = 0; }
            }
        }
    });
}

makePoolFiltrationController("outdoor",
    "wb-mr6cu_91/K1",
    "calculated-flow-sensor-POOL FILTR/flow_rate",
    5000
);
