// Индексы временных окон
var WINDOW_MORNING = 0;
var WINDOW_DAY     = 1;
var WINDOW_EVENING = 2;
var WINDOW_NIGHT   = 3;

// Формат строки расписания: "HH:MM-HH:MM,HH:MM-HH:MM,..."
// Каждая пара — начало и конец временного окна, разделённые дефисом.
// Окна разделяются запятой. Пример: "08:00-11:00,14:00-17:00"

function arrayToString(arr) {
    return arr
        .filter(function (item) {
            return Array.isArray(item) && item.length === 2;
        })
        .map(function (pair) {
            return pair[0] + '-' + pair[1];
        })
        .join(',');
}

function toMinutes(timeStr) {
    var parts = timeStr.split(':');
    var hours = parseInt(parts[0], 10);
    var minutes = parseInt(parts[1], 10);
    return hours * 60 + minutes;
}

function toTimeStr(totalMinutes) {
    totalMinutes = ((totalMinutes % 1440) + 1440) % 1440;
    var hours = Math.floor(totalMinutes / 60) % 24;
    var minutes = Math.floor(totalMinutes % 60);
    return (hours < 10 ? '0' : '') + hours + ':' + (minutes < 10 ? '0' : '') + minutes;
}

function isValidTimeStr(timeStr) {
    if (typeof timeStr !== 'string') { return false; }
    var re = /^\d{2}:\d{2}$/;
    if (!re.test(timeStr)) { return false; }
    var parts = timeStr.split(':');
    var hours = parseInt(parts[0], 10);
    var minutes = parseInt(parts[1], 10);
    return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

// Проверяет, попадает ли текущее время в окно вида "HH:MM-HH:MM"
// Поддерживает окна, переходящие через полночь (например "23:00-01:00")
function isCurrentTimeInWindow(windowStr) {
    // Окно имеет формат "HH:MM-HH:MM", где дефис стоит на позиции 5
    // Используем indexOf чтобы не путать дефис-разделитель с двоеточием
    var sepIndex = windowStr.indexOf('-', 1);
    if (sepIndex === -1) { return false; }

    var startStr = windowStr.substring(0, sepIndex);
    var endStr   = windowStr.substring(sepIndex + 1);

    if (!isValidTimeStr(startStr) || !isValidTimeStr(endStr)) { return false; }

    var now = new Date();
    var currentMinutes = now.getHours() * 60 + now.getMinutes();
    var startTotal = toMinutes(startStr);
    var endTotal   = toMinutes(endStr);

    if (endTotal < startTotal) {
        // Окно переходит через полночь
        return currentMinutes >= startTotal || currentMinutes < endTotal;
    }
    return currentMinutes >= startTotal && currentMinutes < endTotal;
}

// Рассчитывает окна фильтрации относительно времени рассвета и заката.
// windows: массив длительностей в минутах [утро, день, вечер, ночь]
function sunriseSunsetSchedule(sunriseStr, sunsetStr, windows) {
    var sunRise = toMinutes(sunriseStr);
    var sunSet = toMinutes(sunsetStr);
    var result = [null, null, null, null];

    // Утро: начинается сразу после рассвета
    if (windows[WINDOW_MORNING] > 0) {
        var morningStart = sunRise;
        var morningEnd = morningStart + windows[WINDOW_MORNING];
        result[WINDOW_MORNING] = [toTimeStr(morningStart), toTimeStr(morningEnd)];
    }

    // День: середина между рассветом и закатом
    if (windows[WINDOW_DAY] > 0) {
        var midday = sunRise + (sunSet - sunRise) / 2;
        var dayStart = Math.round(midday - windows[WINDOW_DAY] / 2);
        var dayEnd = Math.round(midday + windows[WINDOW_DAY] / 2);
        result[WINDOW_DAY] = [toTimeStr(dayStart), toTimeStr(dayEnd)];
    }

    // Вечер: завершается перед закатом
    if (windows[WINDOW_EVENING] > 0) {
        var eveningEnd = sunSet;
        var eveningStart = eveningEnd - windows[WINDOW_EVENING];
        result[WINDOW_EVENING] = [toTimeStr(eveningStart), toTimeStr(eveningEnd)];
    }

    // Ночь: середина между закатом и рассветом следующего дня
    if (windows[WINDOW_NIGHT] > 0) {
        var nextSunrise = sunRise + 1440;
        var nightMid = sunSet + (nextSunrise - sunSet) / 2;
        var nightStart = Math.round(nightMid - windows[WINDOW_NIGHT] / 2);
        var nightEnd = Math.round(nightMid + windows[WINDOW_NIGHT] / 2);
        result[WINDOW_NIGHT] = [toTimeStr(nightStart), toTimeStr(nightEnd)];
    }

    return result;
}

// Рассчитывает окна фильтрации по фиксированным точкам суток:
// утро — 09:00, день — 15:00, вечер — 21:00, ночь — 03:00
// windows: массив длительностей в минутах [утро, день, вечер, ночь]
function optimizedSchedule(windows) {
    var result = [null, null, null, null];

    if (windows[WINDOW_MORNING] > 0) {
        var morningTime = toMinutes("09:00");
        result[WINDOW_MORNING] = [
            toTimeStr(Math.round(morningTime - windows[WINDOW_MORNING] / 2)),
            toTimeStr(Math.round(morningTime + windows[WINDOW_MORNING] / 2))
        ];
    }

    if (windows[WINDOW_DAY] > 0) {
        var dayTime = toMinutes("15:00");
        result[WINDOW_DAY] = [
            toTimeStr(Math.round(dayTime - windows[WINDOW_DAY] / 2)),
            toTimeStr(Math.round(dayTime + windows[WINDOW_DAY] / 2))
        ];
    }

    if (windows[WINDOW_EVENING] > 0) {
        var eveningTime = toMinutes("21:00");
        result[WINDOW_EVENING] = [
            toTimeStr(Math.round(eveningTime - windows[WINDOW_EVENING] / 2)),
            toTimeStr(Math.round(eveningTime + windows[WINDOW_EVENING] / 2))
        ];
    }

    if (windows[WINDOW_NIGHT] > 0) {
        var nightTime = toMinutes("03:00");
        result[WINDOW_NIGHT] = [
            toTimeStr(Math.round(nightTime - windows[WINDOW_NIGHT] / 2)),
            toTimeStr(Math.round(nightTime + windows[WINDOW_NIGHT] / 2))
        ];
    }

    return result;
}

function makePoolFiltrationSchedule(
    name,
    poolVolumeTopicName,
    pumpFlowRateTopicName,
    filterDiameterTopicName,
    modeTopicName
) {
    var deviceName = "pool-filtration-schedule-" + name;

    defineVirtualDevice(deviceName, {
        title: "Pool Filtration Schedule - " + name,
        cells: {
            target_daily_cycles: {
                type: "range",
                value: 1,
                max: 8,
                min: 1,
                readonly: false
            },
            work_hours_per_day: {
                type: "value",
                unit: "ч",
                readonly: true,
                value: 1
            },
            morning_weight: {
                type: "range",
                value: 1,
                max: 5,
                min: 0,
                readonly: false
            },
            day_weight: {
                type: "range",
                value: 1,
                max: 5,
                min: 0,
                readonly: false
            },
            evening_weight: {
                type: "range",
                value: 1,
                max: 5,
                min: 0,
                readonly: false
            },
            night_weight: {
                type: "range",
                value: 1,
                max: 5,
                min: 0,
                readonly: false
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
            schedule_mode: {
                title: "schedule mode",
                type: "value",
                value: 0,
                readonly: false,
                enum: {
                    0: { en: "Manual", ru: "Вручную" },
                    1: { en: "Sunrise-Sunset", ru: "Рассвет-Закат" },
                    2: { en: "Optimized", ru: "Оптимизированный" }
                }
            },
            // Формат: "HH:MM-HH:MM,HH:MM-HH:MM,..."
            schedule: {
                type: "text",
                readonly: true,
                value: ""
            },
            calc_turnover_time: {
                type: "value",
                unit: "ч",
                readonly: true,
                value: 0
            }
        }
    });

    var targetDailyCyclesTopicName = deviceName + "/target_daily_cycles";
    var workHoursPerDayTopicName   = deviceName + "/work_hours_per_day";
    var morningWeightTopicName     = deviceName + "/morning_weight";
    var dayWeightTopicName         = deviceName + "/day_weight";
    var eveningWeightTopicName     = deviceName + "/evening_weight";
    var nightWeightTopicName       = deviceName + "/night_weight";
    var sunriseTimeTopicName       = deviceName + "/sunrise_time";
    var sunsetTimeTopicName        = deviceName + "/sunset_time";
    var scheduleModeTopicName      = deviceName + "/schedule_mode";
    var scheduleTopicName          = deviceName + "/schedule";
    var calcTurnoverTimeTopicName  = deviceName + "/calc_turnover_time";

    defineRule("pool-cycles-calc-" + name, {
        whenChanged: [
            poolVolumeTopicName,
            pumpFlowRateTopicName,
            filterDiameterTopicName,
            targetDailyCyclesTopicName,
            dayWeightTopicName,
            nightWeightTopicName,
            morningWeightTopicName,
            eveningWeightTopicName,
            sunriseTimeTopicName,
            sunsetTimeTopicName,
            scheduleModeTopicName
        ],
        then: function () {
            var poolVolume = dev[poolVolumeTopicName];
            var pumpFlow = dev[pumpFlowRateTopicName];
            if (!pumpFlow || pumpFlow <= 0) {
                log.warning("[pool-filtration-schedule-{}] pumpFlow is zero", name);
                return;
            }

            var filterDiameter = dev[filterDiameterTopicName];
            if (filterDiameter <= 0) {
                log.warning("[pool-filtration-schedule-{}] filter_diameter is zero or negative", name);
                return;
            }

            var dailyCycles = dev[targetDailyCyclesTopicName];
            var workHoursPerDay = poolVolume / 1000 * dailyCycles / pumpFlow;
            if (workHoursPerDay > 24) { workHoursPerDay = 24; }

            var morningWeight = dev[morningWeightTopicName];
            var dayWeight     = dev[dayWeightTopicName];
            var eveningWeight = dev[eveningWeightTopicName];
            var nightWeight   = dev[nightWeightTopicName];
            var totalWeight   = morningWeight + dayWeight + eveningWeight + nightWeight;

            if (totalWeight === 0) {
                dev[scheduleTopicName] = "";
                dev[workHoursPerDayTopicName] = 0;
                return;
            }

            // Длительности окон в минутах
            var windows = [null, null, null, null];
            windows[WINDOW_MORNING] = workHoursPerDay * morningWeight / totalWeight * 60;
            windows[WINDOW_DAY]     = workHoursPerDay * dayWeight     / totalWeight * 60;
            windows[WINDOW_EVENING] = workHoursPerDay * eveningWeight / totalWeight * 60;
            windows[WINDOW_NIGHT]   = workHoursPerDay * nightWeight   / totalWeight * 60;

            var scheduleMode = dev[scheduleModeTopicName];
            var times = [];

            if (scheduleMode == 1) {
                var sunriseTime = dev[sunriseTimeTopicName];
                var sunsetTime  = dev[sunsetTimeTopicName];
                if (!isValidTimeStr(sunriseTime)) {
                    log.warning("[pool-filtration-schedule-{}] invalid sunrise_time: '{}'", name, sunriseTime);
                    return;
                }
                if (!isValidTimeStr(sunsetTime)) {
                    log.warning("[pool-filtration-schedule-{}] invalid sunset_time: '{}'", name, sunsetTime);
                    return;
                }
                times = sunriseSunsetSchedule(sunriseTime, sunsetTime, windows);
            } else if (scheduleMode == 2) {
                times = optimizedSchedule(windows);
            }

            dev[workHoursPerDayTopicName]  = workHoursPerDay;
            dev[scheduleTopicName]         = arrayToString(times);
            dev[calcTurnoverTimeTopicName] = poolVolume / 1000 / pumpFlow;
        }
    });

    defineRule("filtration-schedule-" + name, {
        when: cron("@every 1m"),
        then: function () {
            var scheduleMode = dev[scheduleModeTopicName];
            if (scheduleMode == 0) { return; }

            var mode = dev[modeTopicName];
            if (mode == 2 || mode == 3) { return; }

            var timeWindowsStr = dev[scheduleTopicName];

            // Если расписание пустое — выключаем насос
            if (!timeWindowsStr || timeWindowsStr === "") {
                if (mode != 0) { dev[modeTopicName] = 0; }
                return;
            }

            var timeWindows = timeWindowsStr.split(',');
            var isInWindow = false;

            for (var i = 0; i < timeWindows.length; i++) {
                if (isCurrentTimeInWindow(timeWindows[i])) {
                    isInWindow = true;
                    break;
                }
            }

            if (isInWindow) {
                if (mode != 1) { dev[modeTopicName] = 1; }
            } else {
                if (mode != 0) { dev[modeTopicName] = 0; }
            }
        }
    });

    return {
        scheduleTopicName: scheduleTopicName,
        scheduleModeTopicName: scheduleModeTopicName
    };
}

// --- Точка входа ---

var sched = makePoolFiltrationSchedule(
    "outdoor",
    "pool-filtration-meter-outdoor/pool_volume",
    "pool-filtration-meter-outdoor/pump_flow_rate",
    "pool-filtration-meter-outdoor/filter_diameter",
    "pool-filtration-ctrl-outdoor/mode"
);
