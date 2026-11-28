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

// Ближайшая граница смены «греть / не греть».
// Возвращает {minutes, heat, heatNow, tomorrow}. Границы после полуночи
// отдаются как «завтра» (minutes > 1440), иначе вечером витрина пустеет
// на два часа и выглядит как сбой расчёта.
function nextSwitch(minutes) {
    var heatNow = zoneAt(minutes) !== ZONE_PEAK;
    var edges = [8 * 60, 11 * 60, 20 * 60, 22 * 60];
    for (var i = 0; i < edges.length; i++) {
        if (edges[i] > minutes) {
            return {
                minutes: edges[i],
                heat: zoneAt(edges[i]) !== ZONE_PEAK,
                heatNow: heatNow,
                tomorrow: false
            };
        }
    }
    return {
        minutes: edges[0] + 1440,
        heat: zoneAt(edges[0]) !== ZONE_PEAK,
        heatNow: heatNow,
        tomorrow: true
    };
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
        manual_day: {
            title: 'Ручной режим включён (дата)',
            type: 'text',
            value: '',
            readonly: true
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
    applied: null,      // что правило само применило к сценарию (null — неизвестно)
    lastReason: '',
    noScenario: false   // внешний канал rule_enabled не виден
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
    var key = dayKeyOf(localMs);

    // Внешний канал может исчезнуть (сценарий переименовали, шлейф отвалился).
    // Без проверки правило молча ретраило бы запись каждые 30 с, а витрина
    // показывала бы штатное состояние при неработающем управлении.
    if (dev[CFG.vd + '/rule_enabled'] === undefined) {
        setCell('reason', 'нет сценария ' + CFG.vd);
        setCell('next_event', '');
        if (!state.noScenario) {
            state.noScenario = true;
            log.error('офис по тарифу: не найден ' + CFG.vd + '/rule_enabled — управление нагревом не работает');
        }
        return;
    }
    if (state.noScenario) {
        state.noScenario = false;
        // Пока канал был не виден, сценарий мог включить кто-то другой (веб-интерфейс,
        // рестарт wb-scenarios). Своё «что я применил» обнуляем, иначе ранний выход
        // по applied решит, что всё уже сделано, и правило не тронет канал.
        state.applied = null;
        state.lastReason = '';
        log.info('офис по тарифу: сценарий снова виден, управление восстановлено');
    }

    // Ручной режим живёт до конца суток. Дата включения берётся из ячейки VD:
    // значения ячеек переживают рестарт wb-rules, а state в памяти — нет,
    // иначе первый тик после деплоя сбрасывал бы выбор пользователя.
    var manualDay = dev[CFG.dev + '/manual_day'];
    if (dev[CFG.dev + '/manual'] === true) {
        if (!manualDay) {
            setCell('manual_day', key);          // только что включили руками
        } else if (manualDay !== key) {
            setCell('manual', false);            // сутки сменились
            setCell('manual_day', '');
            log.info('офис по тарифу: ручной режим сброшен, новые сутки ' + key);
        }
    } else if (manualDay) {
        setCell('manual_day', '');               // выключили руками
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
        // Времени в строке нет намеренно: reason участвует в сравнении
        // «ничего не изменилось», а с минутами он менялся бы каждый тик
        // и публиковал в MQTT новое значение каждую минуту.
        reason = 'пик тарифа';
    } else {
        shouldHeat = true;
        reason = zone === ZONE_NIGHT ? 'ночь, нагрев по термостату' : 'полупик, нагрев по термостату';
    }

    setCell('zone', zone);
    setCell('heating_allowed', shouldHeat);
    setCell('reason', reason);

    var next = nextSwitch(minutes);
    setCell('next_event', (next.tomorrow ? 'завтра ' : '') +
        (next.heat ? 'включить нагрев ' : 'отключить нагрев ') + toTimeStr(next.minutes));

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
