// Version: 1
// Свет в курятнике.
//
// Задача: держать световой день птицы 14 ч с учётом сезона.
// Естественный день короче цели — недостаток добираем лампой:
// 2/3 до восхода и 1/3 после заката, в жёстком окне 04:30–21:00.
// Летом дефицита нет — правило свет не включает вовсе.
//
// Время считаем сами: Date.now() в UTC + TZ_OFFSET_MIN (Самара, UTC+4).
// Часовой пояс контроллера на расчёт не влияет: DST в РФ нет,
// а tz контроллера по умолчанию может быть Europe/Moscow (UTC+3).
//
// Правило пишет в реле только в моменты перехода через границу окна
// (state.applied). Ручное включение выключателем не «отбивается» до
// следующего события расписания. Ручной режим manual — до конца суток.

var CFG = {
    dev: 'svet-kuryatnik',
    relay: 'wb-mrm2-mini_46/K1',
    lat: 53.4591,
    lon: 50.2658,
    tzOffsetMin: 240,          // Самара, UTC+4
    targetDayMin: 14 * 60,     // целевая длина светового дня
    morningShare: 2 / 3,       // доля добавки до восхода
    minOnMin: 4 * 60 + 30,     // не включать раньше 04:30
    maxOffMin: 21 * 60,        // не держать позже 21:00
    dawnMarginMin: 30,         // гаснет через 30 мин после восхода
    tickMs: 30 * 1000
};

var state = {
    applied: null,   // что правило само применило к реле (null — неизвестно)
    dayKey: '',
    retryAt: 0
};

defineVirtualDevice(CFG.dev, {
    title: 'Свет в курятнике',
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
        test_on: {
            title: 'Проверка лампы (2 мин)',
            type: 'pushbutton',
            value: false
        },
        state: {
            title: 'Свет',
            type: 'switch',
            value: false,
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
        day_length: {
            title: 'Длина дня, ч',
            type: 'value',
            value: 0,
            readonly: true
        },
        plan_today: {
            title: 'План на сегодня',
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

// ---------- план на сутки ----------

function buildPlan(localMs) {
    var sun = sunTimes(localMs);
    if (!sun) {
        return { active: false, reason: 'нет восхода/заката' };
    }

    var dayLen = sun.sunset - sun.sunrise;
    var deficit = CFG.targetDayMin - dayLen;
    if (deficit < 0) {
        deficit = 0;
    }

    // Утро даёт morningAdd + dawnMargin минут (лампа гаснет через margin
    // после восхода), вечер — ровно eveningAdd. Сумма этих добавок и есть deficit.
    var morningAdd = Math.round(deficit * CFG.morningShare) - CFG.dawnMarginMin;
    if (morningAdd < 0) {
        morningAdd = 0;
    }
    var eveningAdd = deficit - morningAdd - CFG.dawnMarginMin;
    if (eveningAdd < 0) {
        eveningAdd = 0;
    }

    var on1 = sun.sunrise - morningAdd;
    var off1 = sun.sunrise + CFG.dawnMarginMin;
    var on2 = sun.sunset;
    var off2 = sun.sunset + eveningAdd;

    // Не будим птицу раньше окна: сдвигаем начало, перенося разницу на вечер.
    if (on1 < CFG.minOnMin) {
        var shift = CFG.minOnMin - on1;
        on1 = CFG.minOnMin;
        if (off2 + shift <= CFG.maxOffMin) {
            eveningAdd += shift;
        } else {
            eveningAdd = Math.max(0, CFG.maxOffMin - off2);
        }
        off2 = sun.sunset + eveningAdd;
    }

    // Не держим свет позже окна: срезаем вечер, остаток уходит в утро, если влезает.
    if (off2 > CFG.maxOffMin) {
        var over = off2 - CFG.maxOffMin;
        off2 = CFG.maxOffMin;
        if (on1 - over >= CFG.minOnMin) {
            on1 -= over;
        }
    }

    if (off1 > off2) {
        off1 = off2;
    }

    return {
        active: deficit > 0,
        sunrise: sun.sunrise,
        sunset: sun.sunset,
        dayLen: dayLen,
        deficit: deficit,
        on1: on1,
        off1: off1,
        on2: on2,
        off2: off2
    };
}

function inWindow(minutes, plan) {
    if (!plan.active) {
        return false;
    }
    if (minutes >= plan.on1 && minutes < plan.off1) {
        return true;
    }
    return minutes >= plan.on2 && minutes < plan.off2;
}

function nextEventText(minutes, plan) {
    if (!plan.active) {
        return 'свет не нужен';
    }
    var points = [
        { m: plan.on1, text: 'включить ' + toTimeStr(plan.on1) },
        { m: plan.off1, text: 'выключить ' + toTimeStr(plan.off1) },
        { m: plan.on2, text: 'включить ' + toTimeStr(plan.on2) },
        { m: plan.off2, text: 'выключить ' + toTimeStr(plan.off2) }
    ];
    for (var i = 0; i < points.length; i++) {
        if (points[i].m > minutes) {
            return points[i].text;
        }
    }
    return 'до утра';
}

function planText(plan) {
    if (!plan.active) {
        return 'световой день ' + Math.round(plan.dayLen / 6) / 10 + ' ч, добавка не нужна';
    }
    var parts = [];
    if (plan.off1 > plan.on1) {
        parts.push(toTimeStr(plan.on1) + '-' + toTimeStr(plan.off1));
    }
    if (plan.off2 > plan.on2) {
        parts.push(toTimeStr(plan.on2) + '-' + toTimeStr(plan.off2));
    }
    return parts.join(', ');
}

// ---------- управление реле ----------

function setRelay(on) {
    if (dev[CFG.relay] === on) {
        return true;
    }
    dev[CFG.relay] = on;
    return dev[CFG.relay] === on;
}

function tick() {
    var localMs = Date.now() + CFG.tzOffsetMin * 60000;
    var minutes = localMinutesOfDay(localMs);
    var plan = buildPlan(localMs);

    // Новые сутки — ручной режим снимается сам.
    var key = dayKeyOf(localMs);
    if (key !== state.dayKey) {
        state.dayKey = key;
        if (dev[CFG.dev + '/manual']) {
            dev[CFG.dev + '/manual'] = false;
            log.info('свет курятника: ручной режим сброшен, новые сутки ' + key);
        }
    }

    dev[CFG.dev + '/state'] = dev[CFG.relay] === true;
    dev[CFG.dev + '/sunrise'] = toTimeStr(plan.sunrise || 0);
    dev[CFG.dev + '/sunset'] = toTimeStr(plan.sunset || 0);
    dev[CFG.dev + '/day_length'] = Math.round((plan.dayLen || 0) / 6) / 10;
    dev[CFG.dev + '/plan_today'] = planText(plan);
    dev[CFG.dev + '/next_event'] = nextEventText(minutes, plan);

    if (!dev[CFG.dev + '/enabled'] || dev[CFG.dev + '/manual']) {
        state.applied = null; // после выхода из ручного режима состояние приведём к плану
        return;
    }

    var should = inWindow(minutes, plan);

    if (state.applied === null || should !== state.applied) {
        if (setRelay(should)) {
            state.applied = should;
            log.info('свет курятника: ' + (should ? 'включён' : 'выключен') +
                ' по плану (' + planText(plan) + ')');
        }
    }
}

setInterval(tick, CFG.tickMs);

// Кнопка «проверка лампы»: свет на 2 минуты, дальше состояние снова по плану.
defineRule('svet-kuryatnik-test-on', {
    whenChanged: CFG.dev + '/test_on',
    then: function (newValue) {
        if (!newValue) {
            return;
        }
        if (!setRelay(true)) {
            log.warning('свет курятника: реле не приняло команду проверки');
        }
        dev[CFG.dev + '/test_on'] = false;
        setTimeout(function () {
            state.applied = true; // считаем, что свет включён, чтобы tick вернул план
            tick();
        }, 2 * 60 * 1000);
    }
});

tick();
