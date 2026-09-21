// Version: 1
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

// Тарифные зоны электроэнергии (Самара):
// пик:     07:00-10:00, 17:00-21:00
// полупик: 10:00-17:00, 21:00-23:00
// ночь:    23:00-07:00
// Интервалы в минутах от полуночи; ночной интервал переходит через полночь.
var TARIFF_ZONES = [
    [[toMinutes("07:00"), toMinutes("10:00")], [toMinutes("17:00"), toMinutes("21:00")]],
    [[toMinutes("10:00"), toMinutes("17:00")], [toMinutes("21:00"), toMinutes("23:00")]],
    [[toMinutes("23:00"), toMinutes("07:00") + 1440]]
];

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

// Рассчитывает окна фильтрации по тарифным зонам электроэнергии.
// windows: массив длительностей в минутах [пик, полупик, ночь].
// Внутри каждой зоны минуты распределяются по её интервалам пропорционально
// длине интервала; окно центрируется внутри интервала и зажимается в его границы.
function optimizedSchedule(windows) {
    var result = [];

    for (var z = 0; z < TARIFF_ZONES.length; z++) {
        var minutes = windows[z];
        if (!minutes || minutes <= 0) { continue; }

        var intervals = TARIFF_ZONES[z];
        var totalLen = 0;
        for (var i = 0; i < intervals.length; i++) {
            totalLen += intervals[i][1] - intervals[i][0];
        }
        if (totalLen <= 0) { continue; }

        for (var j = 0; j < intervals.length; j++) {
            var is = intervals[j][0];
            var ie = intervals[j][1];
            var len = ie - is;
            var alloc = minutes * len / totalLen;

            var center = (is + ie) / 2;
            var start = Math.round(center - alloc / 2);
            var end   = Math.round(center + alloc / 2);

            if (start < is) { start = is; end = is + Math.round(alloc); }
            if (end > ie)   { end = ie;   start = ie - Math.round(alloc); }
            if (start < is) { start = is; }

            if (end > start) {
                result.push([toTimeStr(start), toTimeStr(end)]);
            }
        }
    }

    return result;
}

// Сливает пересекающиеся или смежные окна.
// Вход: массив [null | [startStr, endStr], ...]
// Выход: массив [startStr, endStr] (только непустые, слитые)
function mergeOverlappingWindows(times) {
    // Собираем непустые окна в минутах
    var intervals = [];
    for (var i = 0; i < times.length; i++) {
        if (!times[i]) { continue; }
        var s = toMinutes(times[i][0]);
        var e = toMinutes(times[i][1]);
        // Нормализуем: если конец <= начала — окно переходит через полночь
        if (e <= s) { e += 1440; }
        intervals.push([s, e]);
    }

    if (intervals.length === 0) { return []; }

    // Сортируем по началу
    intervals.sort(function (a, b) { return a[0] - b[0]; });

    // Сливаем пересекающиеся/смежные
    var merged = [intervals[0]];
    for (var j = 1; j < intervals.length; j++) {
        var last = merged[merged.length - 1];
        if (intervals[j][0] <= last[1]) {
            // Пересечение — расширяем конец
            if (intervals[j][1] > last[1]) {
                last[1] = intervals[j][1];
            }
        } else {
            merged.push(intervals[j]);
        }
    }

    // Переводим обратно в строки, нормализуем минуты через 1440
    var result = [];
    for (var k = 0; k < merged.length; k++) {
        result.push([toTimeStr(merged[k][0]), toTimeStr(merged[k][1])]);
    }
    return result;
}

// Считает суммарное время работы в часах по массиву слитых окон [[startStr, endStr], ...]
function calcActualWorkHours(mergedTimes) {
    var total = 0;
    for (var i = 0; i < mergedTimes.length; i++) {
        var s = toMinutes(mergedTimes[i][0]);
        var e = toMinutes(mergedTimes[i][1]);
        if (e <= s) { e += 1440; }
        total += e - s;
    }
    return total / 60;
}

function makePoolFiltrationSchedule(
    name,
    poolVolumeTopicName,
    pumpFlowRateTopicName,
    filterDiameterTopicName,
    modeTopicName,
    intentStartTopicName,
    intentStopTopicName
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
            tariff_peak_weight: {
                title: "tariff peak weight",
                type: "range",
                value: 1,
                max: 5,
                min: 0,
                readonly: false
            },
            tariff_semipeak_weight: {
                title: "tariff semipeak weight",
                type: "range",
                value: 1,
                max: 5,
                min: 0,
                readonly: false
            },
            tariff_night_weight: {
                title: "tariff night weight",
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
    var tariffPeakWeightTopicName     = deviceName + "/tariff_peak_weight";
    var tariffSemipeakWeightTopicName = deviceName + "/tariff_semipeak_weight";
    var tariffNightWeightTopicName    = deviceName + "/tariff_night_weight";
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
            tariffPeakWeightTopicName,
            tariffSemipeakWeightTopicName,
            tariffNightWeightTopicName,
            sunriseTimeTopicName,
            sunsetTimeTopicName,
            scheduleModeTopicName
        ],
        then: function () {
            var poolVolume = dev[poolVolumeTopicName];
            var pumpFlow = dev[pumpFlowRateTopicName];
            if (!pumpFlow || pumpFlow <= 0) {
                log.warn("[pool-filtration-schedule-{}] pumpFlow is zero", name);
                return;
            }

            var filterDiameter = dev[filterDiameterTopicName];
            if (filterDiameter <= 0) {
                log.warn("[pool-filtration-schedule-{}] filter_diameter is zero or negative", name);
                return;
            }

            var dailyCycles = dev[targetDailyCyclesTopicName];
            var workHoursPerDay = poolVolume / 1000 * dailyCycles / pumpFlow;
            if (workHoursPerDay > 24) { workHoursPerDay = 24; }

            var scheduleMode = dev[scheduleModeTopicName];
            var times = [];

            if (scheduleMode == 1) {
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

                var sunriseTime = dev[sunriseTimeTopicName];
                var sunsetTime  = dev[sunsetTimeTopicName];
                if (!isValidTimeStr(sunriseTime)) {
                    log.warn("[pool-filtration-schedule-{}] invalid sunrise_time: '{}'", name, sunriseTime);
                    return;
                }
                if (!isValidTimeStr(sunsetTime)) {
                    log.warn("[pool-filtration-schedule-{}] invalid sunset_time: '{}'", name, sunsetTime);
                    return;
                }
                times = sunriseSunsetSchedule(sunriseTime, sunsetTime, windows);
            } else if (scheduleMode == 2) {
                var peakWeight        = dev[tariffPeakWeightTopicName];
                var semipeakWeight    = dev[tariffSemipeakWeightTopicName];
                var tariffNightWeight = dev[tariffNightWeightTopicName];
                var tariffTotal       = peakWeight + semipeakWeight + tariffNightWeight;

                if (tariffTotal === 0) {
                    dev[scheduleTopicName] = "";
                    dev[workHoursPerDayTopicName] = 0;
                    return;
                }

                // Длительности окон по тарифам в минутах [пик, полупик, ночь]
                var tariffWindows = [
                    workHoursPerDay * peakWeight        / tariffTotal * 60,
                    workHoursPerDay * semipeakWeight    / tariffTotal * 60,
                    workHoursPerDay * tariffNightWeight / tariffTotal * 60
                ];
                times = optimizedSchedule(tariffWindows);
            }

            var mergedTimes = mergeOverlappingWindows(times);
            var actualWorkHours = calcActualWorkHours(mergedTimes);

            dev[workHoursPerDayTopicName]  = actualWorkHours;
            dev[scheduleTopicName]         = arrayToString(mergedTimes);
            dev[calcTurnoverTimeTopicName] = poolVolume / 1000 / pumpFlow;
        }
    });

    defineRule("filtration-schedule-" + name, {
        when: cron("@every 1m"),
        then: function () {
            var scheduleMode = dev[scheduleModeTopicName];
            if (scheduleMode == 0) { return; }

            var mode = dev[modeTopicName];
            if (mode == 2 || mode == 3 || mode == 4 || mode == 5) { return; }

            var timeWindowsStr = dev[scheduleTopicName];

            if (!timeWindowsStr || timeWindowsStr === "") {
                if (mode == 1) { dev[intentStopTopicName] = true; }
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
                if (mode == 0) { dev[intentStartTopicName] = true; }
            } else {
                if (mode == 1) { dev[intentStopTopicName] = true; }
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
    "pool-filtration-ctrl-outdoor/mode",
    "pool-filtration-ctrl-outdoor/intent_start",
    "pool-filtration-ctrl-outdoor/intent_stop"
);
