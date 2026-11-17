// Version: 1
// Термостат курятника: ночной режим (дверь открыта днём).
//
// Задача: пока нет концевика двери, не греть курятник, пока дверь открыта,
// то есть от восхода до заката. Ночью и в сумерках работает как раньше.
//
// Правило не считает температуру само: оно включает и выключает правило
// сценария wb-scenarios (wbsc_henhouse2/rule_enabled), поэтому второй
// регулятор на реле не появляется.
//
// Логика:
//   рассвет - закат (до +/- margin) -> сценарий выключен, реле отпущено;
//   вне окна                       -> сценарий включён, гистерезис работает.
// Реле отпускается явно: выключение rule_enabled само актуатор не гасит,
// а после рестарта wb-rules сценарий поднимает нагрев по последней
// температуре, и без явного отпускания он горит до следующего замера.
//
// Всё включено переключателями: enabled — вся логика целиком,
// use_unless_switched — выключать сценарий на дневное окно.
// Ручной режим manual — до конца суток: не трогаем сценарий вовсе.
//
// Время считаем сами: Date.now() в UTC + TZ_OFFSET_MIN (Самара, UTC+4).
// Восход/закат — NOAA-формула, как в svet-kuryatnik.js.

var CFG = {
    dev: 'kuryatnik-termo-dayoff',
    vd: 'wbsc_henhouse2',                // VD сценария термостата
    relay: 'wb-mrm2-mini_46/K2',         // тот же актуатор, что у сценария
    lat: 53.4591,
    lon: 50.2658,
    tzOffsetMin: 240,                    // Самара, UTC+4
    dawnMarginMin: 30,                   // сумерки: не выключать ещё 30 мин после восхода
    duskMarginMin: 30,                   // и не включать раньше, чем за 30 мин до заката
    tickMs: 30 * 1000
};

var state = {
    applied: null,   // что правило само применило к сценарию (null — неизвестно)
    dayKey: '',
    lastReason: ''
};

defineVirtualDevice(CFG.dev, {
    title: 'Курятник: термостат днём',
    cells: {
        enabled: {
            title: 'Автоматика включена',
            type: 'switch',
            value: true
        },
        use_unless_switched: {
            title: 'Отключать нагрев днём (дверь открыта)',
            type: 'switch',
            value: true
        },
        manual: {
            title: 'Ручной режим до конца суток',
            type: 'switch',
            value: false
        },
        heating_allowed: {
            title: 'Нагрев разрешён',
            type: 'switch',
            value: true,
            readonly: true
        },
        reason: {
            title: 'Причина',
            type: 'text',
            value: '',
            readonly: true
        },
        sunrise: {
            title: 'Восход',
            type: 'text',
            value: '',
            readonly: true
        },
        sunset: {
            title: 'Закат',
            type: 'text',
            value: '',
            readonly: true
        },
        next_event: {
            title: 'Следующее переключение',
            type: 'text',
            value: '',
            readonly: true
        }
    }
});

// ---------- время ----------

function pad2(value) {
    return (value < 10 ? '0' : '') + value;
}

function toTimeStr(totalMinutes) {
    var m = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
    return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
}

function localMinutesOfDay(localMs) {
    var d = new Date(localMs);
    return d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
}

function dayKeyOf(localMs) {
    var d = new Date(localMs);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}

function dayOfYear(localMs) {
    var d = new Date(localMs);
    var start = Date.UTC(d.getUTCFullYear(), 0, 1);
    var today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    return Math.floor((today - start) / 86400000) + 1;
}

// ---------- восход и закат (NOAA, точность около минуты) ----------

function sunTimes(localMs) {
    var n = dayOfYear(localMs);
    var gamma = 2 * Math.PI / 365 * (n - 1 + 0.5);
    var eqtime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma) -
        0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
    var decl = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma) -
        0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma) -
        0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);

    var zenith = 90.833 * Math.PI / 180;
    var latRad = CFG.lat * Math.PI / 180;
    var cosHa = (Math.cos(zenith) - Math.sin(latRad) * Math.sin(decl)) /
        (Math.cos(latRad) * Math.cos(decl));

    if (cosHa > 1 || cosHa < -1) {
        return null; // полярный день или ночь: для наших широт не встречается
    }

    var ha = Math.acos(cosHa) * 180 / Math.PI;
    return {
        sunrise: 720 - 4 * (CFG.lon + ha) - eqtime + CFG.tzOffsetMin,
        sunset: 720 - 4 * (CFG.lon - ha) - eqtime + CFG.tzOffsetMin
    };
}

// Окно «дверь открыта»: от рассвета (через dawnMargin) до заката (за duskMargin).
function offWindow(minutes, sun) {
    var from = sun.sunrise - CFG.dawnMarginMin;
    var to = sun.sunset + CFG.duskMarginMin;
    return minutes >= from && minutes < to;
}

// ---------- управление сценарием ----------

function setScenarioEnabled(enabled) {
    if (dev[CFG.vd + '/rule_enabled'] === enabled) {
        return true;
    }
    dev[CFG.vd + '/rule_enabled'] = enabled;
    return dev[CFG.vd + '/rule_enabled'] === enabled;
}

function releaseRelay() {
    if (dev[CFG.relay] === true) {
        dev[CFG.relay] = false;
    }
}

function setCells(heatAllowed, reason, sun, minutes) {
    dev[CFG.dev + '/heating_allowed'] = heatAllowed;
    dev[CFG.dev + '/reason'] = reason;
    if (!sun) {
        return;
    }
    dev[CFG.dev + '/sunrise'] = toTimeStr(sun.sunrise);
    dev[CFG.dev + '/sunset'] = toTimeStr(sun.sunset);
    var f = sun.sunrise - CFG.dawnMarginMin;
    var t = sun.sunset + CFG.duskMarginMin;
    if (minutes < f) {
        dev[CFG.dev + '/next_event'] = 'включить нагрев ' + toTimeStr(f);
    } else if (minutes < t) {
        dev[CFG.dev + '/next_event'] = 'отключить нагрев ' + toTimeStr(t);
    } else {
        dev[CFG.dev + '/next_event'] = 'уже ночь, нагрев работает';
    }
}

function tick() {
    var localMs = Date.now() + CFG.tzOffsetMin * 60000;
    var minutes = localMinutesOfDay(localMs);
    var sun = sunTimes(localMs);

    // Новые сутки — ручной режим снимается сам.
    var key = dayKeyOf(localMs);
    if (key !== state.dayKey) {
        state.dayKey = key;
        if (dev[CFG.dev + '/manual']) {
            dev[CFG.dev + '/manual'] = false;
            log.info('курятник днём: ручной режим сброшен, новые сутки ' + key);
        }
    }

    if (!sun) {
        setCells(true, 'нет восхода/заката — нагрев разрешён', null, minutes);
        if (state.applied !== true && dev[CFG.dev + '/enabled'] && !dev[CFG.dev + '/manual']) {
            state.applied = setScenarioEnabled(true);
        }
        return;
    }

    var shouldHeat;
    var reason;
    if (!dev[CFG.dev + '/enabled']) {
        shouldHeat = true;
        reason = 'автоматика выключена';
    } else if (dev[CFG.dev + '/manual']) {
        shouldHeat = true;
        reason = 'ручной режим до конца суток';
    } else if (!dev[CFG.dev + '/use_unless_switched']) {
        shouldHeat = true;
        reason = 'дневное отключение выключено';
    } else if (offWindow(minutes, sun)) {
        shouldHeat = false;
        reason = 'дверь открыта днём (' + toTimeStr(sun.sunrise) + '-' + toTimeStr(sun.sunset) + ')';
    } else {
        shouldHeat = true;
        reason = 'ночь, нагрев по термостату';
    }

    setCells(shouldHeat, reason, sun, minutes);

    if (state.applied === shouldHeat && reason === state.lastReason) {
        return;
    }

    if (!shouldHeat) {
        if (!setScenarioEnabled(false)) {
            return; // не применилось — попробуем на следующем тике
        }
        releaseRelay();
    } else if (!setScenarioEnabled(true)) {
        return;
    }
    state.applied = shouldHeat;
    state.lastReason = reason;
    if (!shouldHeat) {
        log.info('курятник днём: термостат отключён, реле отпущено (' + reason + ')');
    } else {
        log.info('курятник днём: термостат включён (' + reason + ')');
    }
}

setInterval(tick, CFG.tickMs);

// Как только автоматику включают переключателем или снимают ручной режим —
// приводим сценарий в норму сразу, не дожидаясь ближайшего тика (до 30 с).
defineRule('kuryatnik-termo-dayoff-immediate', {
    whenChanged: [
        CFG.dev + '/enabled',
        CFG.dev + '/manual',
        CFG.dev + '/use_unless_switched'
    ],
    then: function () {
        tick();
    }
});

tick();
