// Version: 1
// Офис: термостат не греет в часы пика тарифа.
//
// Задача: в зоне пика трёхзонного тарифа (08:00-11:00, 20:00-22:00) выключать
// термостат офиса, чтобы киловаттный конвектор не работал по самой дорогой
// цене. В полупик и ночь сценарий работает как раньше. Предпикового перегрева
// нет: правило только выключает и включает, уставку не трогает.
//
// Правило не считает температуру само: оно включает и выключает правило
// сценария wb-scenarios (wbsc_office2/rule_enabled), поэтому второй регулятор
// на том же реле не появляется.
//
// Реле отпускается явно: выключение rule_enabled само актуатор не гасит.
//
// Сторож сценария (scenario-keepalive.js) не должен считать такое выключение
// ручным или аварийным: он подавляется по каналу heating_allowed этого
// устройства, как курятник подавляется правилом дневного режима.
//
// Время считаем сами: Date.now() в UTC + TZ_OFFSET_MIN (Самара, UTC+4).
// Часовой пояс контроллера может быть Europe/Moscow — на него не опираемся.
//
// Движок wb-rules — ECMAScript 5.1, поэтому var и function.

var CFG = {
    dev: 'office-tariff-window',
    vd: 'wbsc_office2',                  // VD сценария термостата офиса
    relay: 'wb-mr6cu_91/K1',             // тот же актуатор, что у сценария
    tzOffsetMin: 240,                    // Самара, UTC+4
    tickMs: 30 * 1000
};

// Тарифные зоны (трёхзонный тариф): интервалы в минутах от полуночи.
// пик      08:00-11:00, 20:00-22:00
// полупик  07:00-08:00, 11:00-20:00, 22:00-23:00
// ночь     23:00-07:00
var PEAK = [
    [8 * 60, 11 * 60],
    [20 * 60, 22 * 60]
];
var SEMI = [
    [7 * 60, 8 * 60],
    [11 * 60, 20 * 60],
    [22 * 60, 23 * 60]
];

var ZONE_PEAK = 'пик';
var ZONE_SEMI = 'полупик';
var ZONE_NIGHT = 'ночь';

function inRanges(minutes, ranges) {
    for (var i = 0; i < ranges.length; i++) {
        if (minutes >= ranges[i][0] && minutes < ranges[i][1]) {
            return true;
        }
    }
    return false;
}

// Зона тарифа для минуты суток (0..1439).
function zoneAt(minutes) {
    if (inRanges(minutes, PEAK)) {
        return ZONE_PEAK;
    }
    if (inRanges(minutes, SEMI)) {
        return ZONE_SEMI;
    }
    return ZONE_NIGHT;
}

function pad2(value) {
    return (value < 10 ? '0' : '') + value;
}

function toTimeStr(totalMinutes) {
    var m = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
    return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
}

// Ближайшая граница смены «греть / не греть» внутри суток.
// Возвращает {minutes, heat} или null, если границ впереди нет.
function nextSwitch(minutes) {
    var heatNow = zoneAt(minutes) !== ZONE_PEAK;
    var best = null;
    var edges = [8 * 60, 11 * 60, 20 * 60, 22 * 60];
    for (var i = 0; i < edges.length; i++) {
        if (edges[i] > minutes) {
            best = edges[i];
            break;
        }
    }
    if (best === null) {
        return null;
    }
    return { minutes: best, heat: zoneAt(best) !== ZONE_PEAK, heatNow: heatNow };
}

function localMinutesOfDay(localMs) {
    var d = new Date(localMs);
    return d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
}

function dayKeyOf(localMs) {
    var d = new Date(localMs);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}

defineVirtualDevice(CFG.dev, {
    title: 'Офис: тарифные зоны',
    cells: {
        enabled: {
            title: 'Автоматика включена',
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
        zone: {
            title: 'Зона тарифа',
            type: 'text',
            value: '',
            readonly: true
        },
        reason: {
            title: 'Причина',
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

var state = {
    applied: null,    // что правило само применило к сценарию (null — неизвестно)
    dayKey: '',
    lastReason: ''
};

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

// Запись в VD только при изменении: иначе каждое тиканье публикует пакет
// в топик, и MQTT-триггер в HA срабатывает на каждое сообщение.
function setCell(control, value) {
    if (dev[CFG.dev + '/' + control] !== value) {
        dev[CFG.dev + '/' + control] = value;
    }
}

function tick() {
    var localMs = Date.now() + CFG.tzOffsetMin * 60000;
    var minutes = localMinutesOfDay(localMs);

    // Новые сутки — ручной режим снимается сам.
    var key = dayKeyOf(localMs);
    if (key !== state.dayKey) {
        state.dayKey = key;
        if (dev[CFG.dev + '/manual']) {
            setCell('manual', false);
            log.info('офис по тарифу: ручной режим сброшен, новые сутки ' + key);
        }
    }

    var zone = zoneAt(minutes);
    var shouldHeat;
    var reason;
    // Сравнение с false, а не отрицание значения: сразу после деплоя retained
    // может ещё не прийти, и `!undefined` выключил бы всю логику.
    if (dev[CFG.dev + '/enabled'] === false) {
        shouldHeat = true;
        reason = 'автоматика выключена';
    } else if (dev[CFG.dev + '/manual'] === true) {
        shouldHeat = true;
        reason = 'ручной режим до конца суток';
    } else if (zone === ZONE_PEAK) {
        shouldHeat = false;
        reason = 'пик тарифа (' + toTimeStr(minutes) + ')';
    } else {
        shouldHeat = true;
        reason = zone === ZONE_NIGHT ? 'ночь, нагрев по термостату' : 'полупик, нагрев по термостату';
    }

    setCell('zone', zone);
    setCell('heating_allowed', shouldHeat);
    setCell('reason', reason);

    var next = nextSwitch(minutes);
    if (next) {
        setCell('next_event', (next.heat ? 'включить нагрев ' : 'отключить нагрев ') +
            toTimeStr(next.minutes));
    } else {
        setCell('next_event', '');
    }

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
        log.info('офис по тарифу: термостат отключён, реле отпущено (' + reason + ')');
    } else {
        log.info('офис по тарифу: термостат включён (' + reason + ')');
    }
}

setInterval(tick, CFG.tickMs);

// Как только автоматику включают переключателем или снимают ручной режим —
// приводим сценарий в норму сразу, не дожидаясь ближайшего тика (до 30 с).
defineRule('office-tariff-window-immediate', {
    whenChanged: [
        CFG.dev + '/enabled',
        CFG.dev + '/manual'
    ],
    then: function () {
        tick();
    }
});

tick();

// Для тестов в node (tests/office-tariff-window.test.js): на контроллере
// module отсутствует, экспорт не мешает.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        zoneAt: zoneAt,
        nextSwitch: nextSwitch,
        inRanges: inRanges,
        PEAK: PEAK,
        SEMI: SEMI
    };
}
