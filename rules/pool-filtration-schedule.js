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

function optimizedSchedule(windows) {
    var result = [null, null, null, null];
    if (windows[0] > 0) {
        var morningTime = toMinutes("09:00");
        var morningStart = Math.round(morningTime - windows[0] / 2);
        var morningEnd = Math.round(morningTime + windows[0] / 2);
        result[0] = [toTimeStr(morningStart), toTimeStr(morningEnd)];
    }
    if (windows[1] > 0) {
        var dayTime = toMinutes("15:00");
        var dayStart = Math.round(dayTime - windows[1] / 2);
        var dayEnd = Math.round(dayTime + windows[1] / 2);
        result[1] = [toTimeStr(dayStart), toTimeStr(dayEnd)];
    }
    if (windows[2] > 0) {
        var eveningTime = toMinutes("21:00");
        var eveningStart = Math.round(eveningTime - windows[2] / 2);
        var eveningEnd = Math.round(eveningTime + windows[2] / 2);
        result[2] = [toTimeStr(eveningStart), toTimeStr(eveningEnd)];
    }
    if (windows[3] > 0) {
        var nightTime = toMinutes("03:00");
        var nightStart = Math.round(nightTime - windows[3] / 2);
        var nightEnd = Math.round(nightTime + windows[3] / 2);
        result[3] = [toTimeStr(nightStart), toTimeStr(nightEnd)];
    }
    return result;
}

function sunriseSunsetSchedule(sunriseStr, sunsetStr, windows) {
    var sunRise = toMinutes(sunriseStr);
    var sunSet = toMinutes(sunsetStr);
    var result = [null, null, null, null];

    if (windows[0] > 0) {
        var morningStart = sunRise;
        var morningEnd = morningStart + windows[0];
        result[0] = [toTimeStr(morningStart), toTimeStr(morningEnd)];
    }
    if (windows[1] > 0) {
        var midday = sunRise + (sunSet - sunRise) / 2;
        var dayStart = Math.round(midday - windows[1] / 2);
        var dayEnd = Math.round(midday + windows[1] / 2);
        result[1] = [toTimeStr(dayStart), toTimeStr(dayEnd)];
    }
    if (windows[2] > 0) {
        var eveningEnd = sunSet;
        var eveningStart = eveningEnd - windows[2];
        result[2] = [toTimeStr(eveningStart), toTimeStr(eveningEnd)];
    }
    if (windows[3] > 0) {
        var nextSunrise = sunRise + 1440;
        var nightMid = sunSet + (nextSunrise - sunSet) / 2;
        var nightStart = Math.round(nightMid - windows[3] / 2);
        var nightEnd = Math.round(nightMid + windows[3] / 2);
        result[3] = [toTimeStr(nightStart), toTimeStr(nightEnd)];
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
    var workHoursPerDayTopicName = deviceName + "/work_hours_per_day";
    var morningWeightTopicName = deviceName + "/morning_weight";
    var dayWeightTopicName = deviceName + "/day_weight";
    var eveningWeightTopicName = deviceName + "/evening_weight";
    var nightWeightTopicName = deviceName + "/night_weight";
    var sunriseTimeTopicName = deviceName + "/sunrise_time";
    var sunsetTimeTopicName = deviceName + "/sunset_time";
    var scheduleModeTopicName = deviceName + "/schedule_mode";
    var scheduleTopicName = deviceName + "/schedule";
    var calcTurnoverTimeTopicName = deviceName + "/calc_turnover_time";

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

            var scheduleMode = dev[scheduleModeTopicName];
            var times = [];

            if (scheduleMode == 1) {
                var sunriseTime = dev[sunriseTimeTopicName];
                var sunsetTime = dev[sunsetTimeTopicName];
                if (!isValidTimeStr(sunriseTime)) {
                    log.warning("[pool-filtration-schedule-{}] invalid sunrise_time: '{}'", name, sunriseTime);
                    return;
                }
                if (!isValidTimeStr(sunsetTime)) {
                    log.warning("[pool-filtration-schedule-{}] invalid sunset_time: '{}'", name, sunsetTime);
                    return;
                }
                times = sunriseSunsetSchedule(
                    sunriseTime,
                    sunsetTime,
                    [morningHours * 60, dayHours * 60, eveningHours * 60, nightHours * 60]
                );
            } else if (scheduleMode == 2) {
                times = optimizedSchedule(
                    [morningHours * 60, dayHours * 60, eveningHours * 60, nightHours * 60]
                );
            }

            dev[workHoursPerDayTopicName] = workHoursPerDay;
            dev[scheduleTopicName] = arrayToString(times);
            dev[calcTurnoverTimeTopicName] = poolVolume / 1000 / pumpFlow;
        }
    });

    defineRule("filtration-schedule-" + name, {
        when: cron("@every 1m"),
        then: function () {
            var scheduleMode = dev[scheduleModeTopicName];
            if (scheduleMode == 0) { return; }
            var mode = dev[modeTopicName];
            if (mode == 2) { return; }

            var timeWindowsStr = dev[scheduleTopicName];
            if (!timeWindowsStr || timeWindowsStr === "") { return; }
            var timeWindows = timeWindowsStr.split(',');

            var now = new Date();
            var currentMinutes = now.getHours() * 60 + now.getMinutes();

            var isInWindow = false;

            for (var i = 0; i < timeWindows.length; i++) {
                var timeWindow = timeWindows[i].split('-');
                if (!timeWindow[0] || !timeWindow[1]) { continue; }
                if (!isValidTimeStr(timeWindow[0]) || !isValidTimeStr(timeWindow[1])) {
                    log.warning("[pool-filtration-schedule-{}] invalid time window: '{}'", name, timeWindows[i]);
                    continue;
                }
                var startParts = timeWindow[0].split(':');
                var endParts = timeWindow[1].split(':');

                var startTotal = parseInt(startParts[0], 10) * 60 + parseInt(startParts[1], 10);
                var endTotal = parseInt(endParts[0], 10) * 60 + parseInt(endParts[1], 10);

                if (endTotal < startTotal) {
                    if (currentMinutes >= startTotal || currentMinutes < endTotal) {
                        isInWindow = true;
                        break;
                    }
                } else {
                    if (currentMinutes >= startTotal && currentMinutes < endTotal) {
                        isInWindow = true;
                        break;
                    }
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
