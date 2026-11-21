// Version: 1
// Сторож сценариев термостатов wb-scenarios (офис, курятник).
//
// Задача: сценарий wb-scenarios выключает себя сам, если канал (датчик или реле)
// держит критическую ошибку 'r'/'w' дольше 10 с. Так было 19.11.2026: локальный
// Keenetic в офисе перезагружался, шина Modbus упала, сценарий офиса отключился
// и остался выключенным на трое суток при 7 °C в помещении.
//
// Сторож возвращает сценарий в работу, когда связь восстановилась, и НИКОГДА
// не спорит с ручным выключением:
//   - критическая ошибка канала сейчас  -> запоминаем время, ждём;
//   - сценарий включён                  -> всё в порядке;
//   - сценарий выключен, ошибок не было дольше 30 мин -> это руками, не трогаем;
//   - сценарий выключен, с последней ошибки прошло < 5 мин -> ждём стабилизации;
//   - прошло >= 5 мин -> включаем и перечитываем топик;
//   - 5 лечений за 6 часов -> сторож выключает сам себя и требует человека.
//
// Курятник: у него днём сценарий выключает штатное правило
// kuryatnik-termo-dayoff.js (дверь открыта). Пока heating_allowed = 0,
// сторож молчит и в дневной режим не вмешивается.
//
// Поля для HA (WB сам не пушит): alert_code меняется только когда сценарий
// реально выключен/вылечен, HA читает его MQTT-триггером и пушит.
//   0 — всё в порядке (в т.ч. ручное выключение)
//   1 — сценарий выключен, сторож ждёт стабилизации
//   2 — сценарий вылечен (включён обратно)
//   3 — включить не удалось (контрол не принял запись)
//   4 — тормоз: слишком частые аварии, нужен человек
//
// Время в VD — местное (Самара, UTC+4), как в остальных домашних правилах.

var CFG = {
    tickMs: 60 * 1000,
    manualWindowMs: 30 * 60 * 1000,
    healDelayMs: 5 * 60 * 1000,
    brakeWindowMs: 6 * 60 * 60 * 1000,
    brakeCount: 5,
    tzOffsetMin: 240,
    targets: [
        {
            key: 'office',
            title: 'Офис: сторож сценария',
            vd: 'wbsc_office2',
            label: 'Офис',
            sensor: 'wb-m1w2_118/External Sensor 1',
            actuator: 'wb-mr6cu_91/K1',
            inhibit: null
        },
        {
            key: 'henhouse',
            title: 'Курятник: сторож сценария',
            vd: 'wbsc_henhouse2',
            label: 'Курятник',
            sensor: 'wb-m1w2_33/External Sensor 1',
            actuator: 'wb-mrm2-mini_46/K2',
            inhibit: 'kuryatnik-termo-dayoff/heating_allowed'
        }
    ]
};

var STATE = {
    OK: 0,
    MANUAL: 1,
    WAITING_STABLE: 2,
    HEALED: 3,
    CHANNEL_ERROR: 4,
    HEAL_FAILED: 5,
    BRAKE: 6,
    DISABLED: 7,
    SUPPRESSED: 8
};

var store = new PersistentStorage('thermostat-keepalive', { global: true });

// ---------- вспомогательное ----------

function pad2(value) {
    return (value < 10 ? '0' : '') + value;
}

function fmtTime(ms) {
    if (!ms) {
        return '';
    }
    var d = new Date(ms + CFG.tzOffsetMin * 60000);
    return pad2(d.getUTCDate()) + '.' + pad2(d.getUTCMonth() + 1) + '.' +
        d.getUTCFullYear() + ' ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
}

function isCritical(errVal) {
    if (typeof errVal !== 'string') {
        return false;
    }
    return errVal.indexOf('r') !== -1 || errVal.indexOf('w') !== -1;
}

function loadNum(key) {
    var raw = store[key];
    var num = parseInt(raw, 10);
    return isNaN(num) ? 0 : num;
}

function loadHealTimes(key) {
    var raw = store[key];
    if (typeof raw !== 'string' || raw === '') {
        return [];
    }
    try {
        var list = JSON.parse(raw);
        return list instanceof Array ? list : [];
    } catch (e) {
        return [];
    }
}

function saveHealTimes(key, list) {
    var cutoff = Date.now() - CFG.brakeWindowMs;
    var kept = [];
    for (var i = 0; i < list.length; i++) {
        if (list[i] > cutoff) {
            kept.push(list[i]);
        }
    }
    store[key] = JSON.stringify(kept);
    return kept;
}

// ---------- виртуальные устройства ----------

function makeVd(t) {
    defineVirtualDevice(t.key + '-keepalive', {
        title: t.title,
        cells: {
            enabled: {
                title: 'Сторож включён',
                type: 'switch',
                value: true
            },
            state: {
                title: 'Состояние',
                type: 'value',
                value: STATE.OK,
                readonly: true,
                enum: {
                    0: 'Сценарий работает',
                    1: 'Выключен вручную',
                    2: 'Жду стабилизации',
                    3: 'Вылечен',
                    4: 'Канал в ошибке',
                    5: 'Не удалось включить',
                    6: 'Тормоз',
                    7: 'Сторож выключен',
                    8: 'Подавлен штатным режимом'
                }
            },
            alert_code: {
                title: 'Код для HA (пушит HA)',
                type: 'value',
                value: 0,
                readonly: true,
                enum: {
                    0: 'Нет тревоги',
                    1: 'Сценарий выключен, жду',
                    2: 'Сценарий вылечен',
                    3: 'Не удалось включить',
                    4: 'Тормоз: частые аварии'
                }
            },
            alert_text: {
                title: 'Текст тревоги',
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
            last_error: {
                title: 'Последняя ошибка канала',
                type: 'text',
                value: '',
                readonly: true
            },
            last_heal: {
                title: 'Последнее лечение',
                type: 'text',
                value: '',
                readonly: true
            },
            heal_count: {
                title: 'Лечений за 6 часов',
                type: 'value',
                value: 0,
                readonly: true
            }
        }
    });
}

for (var i = 0; i < CFG.targets.length; i++) {
    makeVd(CFG.targets[i]);
}

// ---------- логика ----------

function setAlert(t, code, text) {
    dev[t.key + '-keepalive/alert_code'] = code;
    dev[t.key + '-keepalive/alert_text'] = text;
}

function setState(t, state, reason, alertCode, alertText) {
    dev[t.key + '-keepalive/state'] = state;
    dev[t.key + '-keepalive/reason'] = reason;
    setAlert(t, alertCode, alertText);
}

function channelError(t) {
    var sensorErr = dev[t.sensor + '#error'];
    var actuatorErr = dev[t.actuator + '#error'];
    var parts = [];
    if (isCritical(sensorErr)) {
        parts.push('датчик: ' + sensorErr);
    }
    if (isCritical(actuatorErr)) {
        parts.push('реле: ' + actuatorErr);
    }
    return parts.join(', ');
}

function heal(t) {
    dev[t.vd + '/rule_enabled'] = true;
    setTimeout(function () {
        var now = Date.now();
        var key = t.key + '_healTimes';
        if (dev[t.vd + '/rule_enabled'] === true) {
            var list = loadHealTimes(key);
            list.push(now);
            list = saveHealTimes(key, list);
            dev[t.key + '-keepalive/last_heal'] = fmtTime(now);
            dev[t.key + '-keepalive/heal_count'] = list.length;
            setState(t, STATE.HEALED, 'связь восстановилась, сценарий включён',
                2, t.label + ': сценарий включён обратно, связь восстановилась');
            log.info(t.label + ': сценарий вылечен, лечений за 6 ч: ' + list.length);
        } else {
            setState(t, STATE.HEAL_FAILED,
                'запись rule_enabled не применилась — проверить readonly/связь',
                3, t.label + ': не смог вернуть сценарий, нужно посмотреть руками');
            log.error(t.label + ': не удалось включить сценарий (запись не применилась)');
        }
    }, 3000);
}

function tick(t) {
    var key = t.key + '_lastErrorAt';
    var errText = channelError(t);
    var now = Date.now();

    if (dev[t.key + '-keepalive/enabled'] === false) {
        setState(t, STATE.DISABLED, 'сторож выключен переключателем', 0, '');
        return;
    }

    if (errText !== '') {
        store[key] = now;
        dev[t.key + '-keepalive/last_error'] = fmtTime(now) + ' — ' + errText;
        if (dev[t.vd + '/rule_enabled'] === false) {
            setState(t, STATE.CHANNEL_ERROR, 'канал в критической ошибке, сценарий уже выключен',
                1, t.label + ': сценарий выключен, связь с каналом потеряна (' + errText + ')');
        } else {
            setState(t, STATE.CHANNEL_ERROR, 'канал в критической ошибке, жду', 0, '');
        }
        return;
    }

    if (t.inhibit && dev[t.inhibit] === false) {
        setState(t, STATE.SUPPRESSED, 'штатный режим (день, нагрев запрещён)', 0, '');
        return;
    }

    if (dev[t.vd + '/rule_enabled'] === true) {
        setState(t, STATE.OK, 'сценарий работает', 0, '');
        return;
    }

    var lastErrorAt = loadNum(key);
    if (!lastErrorAt) {
        setState(t, STATE.MANUAL, 'выключен без ошибок канала — считаю ручным', 0, '');
        return;
    }

    var age = now - lastErrorAt;
    if (age > CFG.manualWindowMs) {
        setState(t, STATE.MANUAL, 'выключен ' + fmtTime(lastErrorAt) +
            ', ошибок нет дольше 30 мин — считаю ручным', 0, '');
        return;
    }

    if (age < CFG.healDelayMs) {
        setState(t, STATE.WAITING_STABLE, 'сценарий выключен ' + fmtTime(lastErrorAt) +
            ', жду стабилизации до ' + fmtTime(lastErrorAt + CFG.healDelayMs),
            1, t.label + ': сценарий выключен после сбоя связи, слежу');
        return;
    }

    var healTimes = saveHealTimes(t.key + '_healTimes', loadHealTimes(t.key + '_healTimes'));
    dev[t.key + '-keepalive/heal_count'] = healTimes.length;
    if (healTimes.length >= CFG.brakeCount) {
        dev[t.key + '-keepalive/enabled'] = false;
        setState(t, STATE.BRAKE, 'лечений за 6 ч: ' + healTimes.length +
            ' — сторож остановлен, нужен человек',
            4, t.label + ': связь сыпется постоянно, сторож остановлен (5 лечений за 6 ч)');
        log.error(t.label + ': тормоз, лечений за 6 ч: ' + healTimes.length);
        return;
    }

    log.info(t.label + ': связь в порядке, включаю сценарий (ошибка была ' + fmtTime(lastErrorAt) + ')');
    heal(t);
}

function tickAll() {
    for (var k = 0; k < CFG.targets.length; k++) {
        tick(CFG.targets[k]);
    }
}

// Мгновенный пересчёт по важным событиям, не дожидаясь тика.
var watchTopics = [];
for (var w = 0; w < CFG.targets.length; w++) {
    var t = CFG.targets[w];
    watchTopics.push(t.vd + '/rule_enabled');
    watchTopics.push(t.sensor + '#error');
    watchTopics.push(t.actuator + '#error');
    watchTopics.push(t.key + '-keepalive/enabled');
    if (t.inhibit) {
        watchTopics.push(t.inhibit);
    }
}

defineRule('thermostat-keepalive-events', {
    whenChanged: watchTopics,
    then: function () {
        tickAll();
    }
});

setInterval(tickAll, CFG.tickMs);
tickAll();
