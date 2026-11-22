// Version: 1
// Сторож сценариев термостатов wb-scenarios (офис, курятник).
//
// Задача: сценарий wb-scenarios выключает себя сам, если канал (датчик или реле)
// держит критическую ошибку 'r'/'w' дольше 10 с. Так было 19.11.2026: локальный
// Keenetic в офисе перезагружался, шина Modbus упала, сценарий офиса отключился
// и остался выключенным на трое суток при 7 °C в помещении.
//
// Движок wb-rules — ECMAScript 5.1 (`let`/`const` и стрелочные функции не
// поддерживаются), поэтому здесь var и function. Это осознанно, а не устаревший
// стиль: см. README wb-rules и AGENTS.md проекта.
//
// Сторож возвращает сценарий в работу, когда связь восстановилась, и не
// трогает сценарий, который выключили руками:
//   - критическая ошибка канала сейчас -> запоминаем время, ждём;
//   - сценарий включён                 -> всё в порядке;
//   - сценарий выключен, но сторож не видел аварийного выключения -> считаю
//     ручным и не вмешиваюсь, сколько бы времени ни прошло;
//   - сценарий выключился сам из-за ошибки канала (маркер самоотключения) ->
//     ждём стабилизации 5 мин, затем включаем и перечитываем топик;
//   - ручное выключение при живой ошибке канала неотличимо от защиты
//     wb-scenarios: такой сценарий сторож тоже вернёт после стабилизации
//     (в лог пишется предупреждение);
//   - 5 лечений за 6 часов (CFG.brakeCount / CFG.brakeWindowMs) -> сторож
//     выключает сам себя и требует человека; ручное включение переключателя
//     сбрасывает счётчик.
//
// Чтобы выключить сценарий надолго, выключите переключатель «Сторож включён»:
// иначе сторож вернёт сценарий в работу после аварии.
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
//   5 — не найдены топики сценария/канала: неверные имена устройств
//
// Время в VD — местное (Самара, UTC+4), как в остальных домашних правилах.

var CFG = {
    tickMs: 60 * 1000,
    healDelayMs: 5 * 60 * 1000,
    brakeWindowMs: 6 * 60 * 60 * 1000,
    brakeCount: 5,
    startupGraceMs: 60 * 1000,
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
    SUPPRESSED: 8,
    NO_CONFIG: 9
};

var store = new PersistentStorage('thermostat-keepalive', { global: true });
var startedAt = Date.now();
var pendingHeal = {};   // key -> время попытки включения, ждёт подтверждения

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

// '#error' по конвенции заполняется только при ошибке: пусто или отсутствует —
// канал в порядке. Любой непустой код считаем критическим: если новый драйвер
// сменит формат, авария не должна стать невидимой. Незнакомый код пишем в лог
// один раз, чтобы смена формата была видна.
var warnedErrorCodes = Object.create(null);

function isCritical(errVal) {
    if (errVal === undefined || errVal === null || errVal === '') {
        return false;
    }
    if (errVal !== 'r' && errVal !== 'w' && errVal !== 'rw' && !warnedErrorCodes[errVal]) {
        warnedErrorCodes[errVal] = true;
        log.warning('неизвестный код ошибки канала: ' + errVal);
    }
    return true;
}

// Проверка существования контрола: при переименовании устройства dev[...]
// молча вернёт null, и сторож завис бы без единой записи в лог.
function controlExists(topic) {
    var slash = topic.indexOf('/');
    if (slash === -1) {
        return false;
    }
    var device = getDevice(topic.substr(0, slash));
    return !!device && device.isControlExists(topic.substr(slash + 1));
}

function missingTopics(t) {
    var topics = [
        t.vd + '/rule_enabled',
        t.sensor,
        t.actuator,
        t.key + '-keepalive/enabled'
    ];
    if (t.inhibit) {
        topics.push(t.inhibit);
    }
    var missing = [];
    for (var i = 0; i < topics.length; i++) {
        if (!controlExists(topics[i])) {
            missing.push(topics[i]);
        }
    }
    return missing;
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
                    8: 'Подавлен штатным режимом',
                    9: 'Не найдены топики'
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
                    4: 'Тормоз: частые аварии',
                    5: 'Не найдены топики сценария'
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
                title: 'Лечений за ' + Math.round(CFG.brakeWindowMs / 3600000) + ' ч',
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

// Пишем в VD только при реальном изменении: каждое сообщение в топик
// срабатывает как MQTT-триггер в HA, и безусловная запись на каждом тике
// превращается в спам пушей (проверено на живой автоматизации).
function setCell(t, control, value) {
    var topic = t.key + '-keepalive/' + control;
    if (dev[topic] !== value) {
        dev[topic] = value;
    }
}

function setAlert(t, code, text) {
    setCell(t, 'alert_code', code);
    setCell(t, 'alert_text', text);
}

function setState(t, state, reason, alertCode, alertText) {
    setCell(t, 'state', state);
    setCell(t, 'reason', reason);
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

// Любая попытка включения (удачная и нет) расходует ресурс тормоза: иначе при
// устойчиво не принимающейся записи сторож лечил бы по кругу каждую минуту.
function addAttempt(t) {
    var key = t.key + '_healTimes';
    var list = loadHealTimes(key);
    list.push(Date.now());
    return saveHealTimes(key, list);
}

// Попытка не подтверждается таймером: результат проверяем на следующем тике.
// Виртуальное устройство применяет запись сразу, поэтому уже событие на
// rule_enabled вызовет tick() и закроет попытку; при ошибке — следующий тик.
function heal(t) {
    // Сначала pending, потом запись: событие на rule_enabled может прийти
    // синхронно, и confirmHeal обязан найти ожидаемую попытку.
    pendingHeal[t.key] = Date.now();
    dev[t.vd + '/rule_enabled'] = true;
}

function confirmHeal(t, ruleEnabled) {
    var at = pendingHeal[t.key];
    if (!at) {
        return false;
    }
    // Попытка не живёт дольше нескольких тиков: если между записью и
    // подтверждением тик ушёл в ранний return (NO_CONFIG, выключенный сторож),
    // зависшая попытка позже соврёт про HEALED/HEAL_FAILED.
    if (Date.now() - at > 3 * CFG.tickMs) {
        // Попытка была сделана (запись ушла), поэтому она так же расходует
        // ресурс тормоза — просто подтверждение потерялось.
        var attempts = addAttempt(t);
        setCell(t, 'heal_count', attempts.length);
        delete pendingHeal[t.key];
        log.warning(t.label + ': подтверждение лечения не дождалось, попытка учтена в тормозе');
        return false;
    }
    delete pendingHeal[t.key];
    var list = addAttempt(t);
    setCell(t, 'heal_count', list.length);
    if (ruleEnabled === true) {
        setCell(t, 'last_heal', fmtTime(at));
        setState(t, STATE.HEALED, 'связь восстановилась, сценарий включён',
            2, t.label + ': сценарий включён обратно, связь восстановилась');
        log.info(t.label + ': сценарий вылечен, лечений за 6 ч: ' + list.length);
    } else {
        setCell(t, 'last_heal', fmtTime(at) + ' — запись не применилась');
        setState(t, STATE.HEAL_FAILED,
            'запись rule_enabled не применилась — проверить readonly/связь',
            3, t.label + ': не смог вернуть сценарий, нужно посмотреть руками');
        log.error(t.label + ': не удалось включить сценарий (запись не применилась)');
    }
    return true;
}

// Какой сценарий выключился сам, а какой выключили руками. Маркер ставим только
// если сценарий до этого работал, а выключение совпало с живой ошибкой канала.
// Выключение без ошибки (или ошибка, пришедшая уже после ручного выключения)
// маркер не ставит. Маркер живёт до включения сценария, поэтому дневное окно
// курятника его не «съедает» по возрасту.
function trackScenario(t, ruleEnabled, errText) {
    var prev = store[t.key + '_ruleWasEnabled'];
    if (ruleEnabled === true) {
        if (store[t.key + '_autoOff'] === '1') {
            store[t.key + '_autoOff'] = '0';
        }
        if (prev !== '1') {
            store[t.key + '_ruleWasEnabled'] = '1';
        }
        return;
    }
    if (ruleEnabled !== false) {
        return;
    }
    // Истории ещё нет (первый запуск после установки) — считаем аварией:
    // лучше вернуть сценарий, чем повторить исходный инцидент.
    if (errText !== '' && prev !== '0') {
        store[t.key + '_autoOff'] = '1';
        // Ручное выключение при живой ошибке неотличимо от защиты wb-scenarios.
        // Пишем в лог, чтобы возврат сценария можно было объяснить задним числом.
        log.warning(t.label + ': сценарий выключен при активной ошибке канала — ' +
            'считаю самоотключением и верну его после стабилизации');
    }
    if (prev !== '0') {
        store[t.key + '_ruleWasEnabled'] = '0';
    }
}

function tick(t) {
    var now = Date.now();
    var stateTopic = t.key + '-keepalive/state';
    var enabledTopic = t.key + '-keepalive/enabled';
    var ruleEnabled = dev[t.vd + '/rule_enabled'];
    var errText = channelError(t);

    // wb-rules получает retained-значения не мгновенно: первые секунды после
    // старта решения не принимаем. Самоотключение при этом всё равно
    // запоминаем — wb-scenarios может выключить сценарий уже в этом окне.
    if (now - startedAt < CFG.startupGraceMs) {
        trackScenario(t, ruleEnabled, errText);
        if (errText !== '') {
            // Время ошибки нужно и для 5-минутной стабилизации: иначе ошибка,
            // ушедшая до первого полного тика, даст лечение без выдержки.
            store[t.key + '_lastErrorAt'] = now;
        }
        return;
    }

    // Выключатель проверяем раньше диагностики топиков: выключенный сторож
    // не должен поднимать тревогу NO_CONFIG и затирать состояние BRAKE.
    if (dev[enabledTopic] === false) {
        // Тормоз выключает сторож сам: его состояние и тревогу не затираем.
        if (dev[stateTopic] !== STATE.BRAKE) {
            setState(t, STATE.DISABLED, 'сторож выключен переключателем', 0, '');
        }
        return;
    }

    var missing = missingTopics(t);
    if (missing.length > 0 || ruleEnabled === null || ruleEnabled === undefined) {
        if (missing.indexOf(t.vd + '/rule_enabled') === -1 &&
                (ruleEnabled === null || ruleEnabled === undefined)) {
            missing.push(t.vd + '/rule_enabled (нет значения)');
        }
        if (dev[stateTopic] !== STATE.NO_CONFIG) {
            log.error(t.label + ': сторож не может работать, не найдены топики: ' +
                missing.join(', ') + ' — проверьте имена устройств сценария');
        }
        setState(t, STATE.NO_CONFIG, 'не найдены топики: ' + missing.join(', '),
            5, t.label + ': не найдены топики сценария/канала, сторож не работает');
        return;
    }

    if (confirmHeal(t, ruleEnabled)) {
        return;
    }

    if (dev[stateTopic] === STATE.BRAKE) {
        // Человек включил сторож после тормоза — это и есть сброс счётчика.
        store[t.key + '_healTimes'] = '[]';
        setCell(t, 'heal_count', 0);
        log.info(t.label + ': тормоз сброшен вручную, счётчик лечений обнулён');
    }

    // Подавление проверяем раньше ошибок: днём курятником владеет
    // kuryatnik-termo-dayoff.js, и ложные пуши про потерянную связь не нужны.
    if (t.inhibit && dev[t.inhibit] === false) {
        setState(t, STATE.SUPPRESSED, 'штатный режим (день, нагрев запрещён)', 0, '');
        return;
    }

    trackScenario(t, ruleEnabled, errText);

    if (errText !== '') {
        store[t.key + '_lastErrorAt'] = now;
        setCell(t, 'last_error', fmtTime(now) + ' — ' + errText);
        if (ruleEnabled === false && store[t.key + '_autoOff'] === '1') {
            setState(t, STATE.CHANNEL_ERROR,
                'канал в критической ошибке, сценарий выключен из-за неё',
                1, t.label + ': сценарий выключен, связь с каналом потеряна (' + errText + ')');
        } else if (ruleEnabled === false) {
            setState(t, STATE.CHANNEL_ERROR,
                'канал в критической ошибке, сценарий выключен вручную', 0, '');
        } else {
            setState(t, STATE.CHANNEL_ERROR, 'канал в критической ошибке, жду', 0, '');
        }
        return;
    }

    if (ruleEnabled === true) {
        setState(t, STATE.OK, 'сценарий работает', 0, '');
        return;
    }

    if (store[t.key + '_autoOff'] !== '1') {
        setState(t, STATE.MANUAL,
            'выключен без аварийного самоотключения — считаю ручным', 0, '');
        return;
    }

    var lastErrorAt = loadNum(t.key + '_lastErrorAt');
    if (lastErrorAt && now - lastErrorAt < CFG.healDelayMs) {
        setState(t, STATE.WAITING_STABLE, 'сценарий выключен ' + fmtTime(lastErrorAt) +
            ', жду стабилизации до ' + fmtTime(lastErrorAt + CFG.healDelayMs),
            1, t.label + ': сценарий выключен после сбоя связи, слежу');
        return;
    }

    var healTimes = saveHealTimes(t.key + '_healTimes', loadHealTimes(t.key + '_healTimes'));
    setCell(t, 'heal_count', healTimes.length);
    if (healTimes.length >= CFG.brakeCount) {
        var windowH = Math.round(CFG.brakeWindowMs / 3600000);
        // Сначала состояние и тревога, потом переключатель: запись в enabled
        // сама вызывает tick(), и он не должен затереть BRAKE.
        setState(t, STATE.BRAKE, 'лечений за ' + windowH + ' ч: ' + healTimes.length +
            ' — сторож остановлен, нужен человек',
            4, t.label + ': связь сыпется постоянно, сторож остановлен (' +
                CFG.brakeCount + ' лечений за ' + windowH + ' ч)');
        dev[enabledTopic] = false;
        log.error(t.label + ': тормоз, лечений за ' + windowH + ' ч: ' + healTimes.length);
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

// Первый тик — только после startupGraceMs: к этому моменту wb-rules уже
// получил retained-значения MQTT, и пустые топики не выглядят аварией.

// Хуки для Node-тестов: на контроллере module нет, правило работает как обычно.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        CFG: CFG,
        STATE: STATE,
        targets: CFG.targets,
        tickAll: tickAll,
        tick: tick,
        isCritical: isCritical
    };
}
