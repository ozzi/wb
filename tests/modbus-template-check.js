#!/usr/bin/env node
// Статическая проверка шаблона Modbus TCP для wb-mqtt-serial.
//
//   node tests/modbus-template-check.js templates/config-victron-solarcharger.json
//
// Проверяет то, что драйвер молча проглотит, а потом отдаст мусор в MQTT:
// дубли id, формат и error_value, word_order у 32-битных, перекрытие адресов,
// размер группы чтения по правилам mc.cpp (max_reg_hole).
// Код возврата 1, если найдена хотя бы одна проблема.

var fs = require('fs');

var FORMATS = {
    u8: { signed: false, bytes: 1 },
    s8: { signed: true, bytes: 1 },
    u16: { signed: false, bytes: 2 },
    s16: { signed: true, bytes: 2 },
    u24: { signed: false, bytes: 3 },
    s24: { signed: true, bytes: 3 },
    u32: { signed: false, bytes: 4 },
    s32: { signed: true, bytes: 4 },
    u64: { signed: false, bytes: 8 },
    s64: { signed: true, bytes: 8 }
};

// Пределы wb-mqtt-serial: MAX_READ_REGISTERS и MAX_HOLE_CONTINUOUS_16_BIT_REGISTERS
// (src/modbus_common.cpp). Максимальная дыра — 16 регистров.
var MAX_READ_REGISTERS = 125;
var MAX_HOLE = 16;
// Подразумеваемый размер блока при max_reg_hole: в шаблоне задаётся max_read_registers,
// поэтому считаем по нему, а не по 125.
var DEFAULT_MAX_READ = 7;

function fail(errors, msg) {
    errors.push(msg);
}

function regWords(ch) {
    if (!FORMATS[ch.format]) return 1; // о формате уже сообщено отдельной ошибкой
    return Math.ceil(FORMATS[ch.format].bytes / 2);
}

function formatRange(fmt) {
    var bits = FORMATS[fmt].bytes * 8;
    if (FORMATS[fmt].signed) {
        var hi = Math.pow(2, bits - 1) - 1;
        return -hi - 1 + '..' + hi;
    }
    return '0..' + Math.pow(2, bits) - 1;
}

// error_value в шаблоне — строка вида "0xFFFF"; null если не задан или не разбирается
function parseErrorValue(v) {
    if (v === undefined || v === null) return null;
    if (typeof v === 'number') return v;
    var s = String(v).trim();
    if (/^0x[0-9a-fA-F]+$/.test(s)) return parseInt(s, 16);
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    return null;
}

// Группировка регистров в диапазоны чтения, как в mc.cpp TModbusRegisterRange::AddRegister.
// Возвращает список диапазонов {start, count, maxRegsPerRequest} и худший запрос.
function readRanges(channels, device, errors) {
    var regs = [];
    channels.forEach(function (ch) {
        regs.push({ addr: ch.address, words: regWords(ch), id: ch.id });
    });
    regs.sort(function (a, b) { return a.addr - b.addr || a.words - b.words; });

    var maxHole = device.max_reg_hole || 0;
    var maxRead = device.max_read_registers || DEFAULT_MAX_READ;
    if (maxRead > MAX_READ_REGISTERS) maxRead = MAX_READ_REGISTERS;
    if (maxHole > MAX_HOLE) {
        errors.push('max_reg_hole=' + maxHole + ' больше допустимого ' + MAX_HOLE);
        maxHole = MAX_HOLE;
    }
    if (device.max_read_registers > MAX_READ_REGISTERS) {
        errors.push('max_read_registers=' + device.max_read_registers +
            ' больше предела Modbus ' + MAX_READ_REGISTERS);
    }

    var ranges = [];
    var current = null;
    regs.forEach(function (r) {
        if (current &&
            r.addr >= current.start &&
            r.addr + r.words <= current.start + current.count) {
            return; // уже внутри диапазона
        }
        if (current && r.addr >= current.start &&
            current.start + current.count + maxHole >= r.addr &&
            r.addr + r.words - current.start <= maxRead) {
            current.count = Math.max(current.count, r.addr + r.words - current.start);
            return;
        }
        current = { start: r.addr, count: r.words, ids: [r.id] };
        ranges.push(current);
    });
    ranges.forEach(function (r) {
        // count + max_reg_hole — регистры, которые драйвер прочитает одним запросом,
        // выбирая границы диапазона; count — то, что шаблон реально объявляет.
        r.askedRegisters = r.count + maxHole;
        r.maxRegsPerRequest = Math.min(r.askedRegisters, MAX_READ_REGISTERS);
    });
    return ranges;
}

function check(file) {
    var errors = [];
    var tpl;
    try {
        tpl = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        return ['не удалось прочитать JSON: ' + e.message];
    }

    var dev = tpl.device;
    if (!dev || !Array.isArray(dev.channels) || !dev.channels.length) {
        return ['в шаблоне нет device.channels'];
    }
    if (!tpl.device_type) fail(errors, 'не задан device_type');
    if (!dev.id) fail(errors, 'не задан device.id');

    var byId = {};
    var byAddr = {};
    dev.channels.forEach(function (ch) {
        var where = (ch.id || ch.name || '?');

        if (!ch.id) fail(errors, where + ': нет id');
        else if (byId[ch.id]) fail(errors, 'дубль id: ' + ch.id);
        else byId[ch.id] = true;

        if (!FORMATS[ch.format]) {
            fail(errors, where + ': неизвестный формат "' + ch.format + '"');
            return;
        }
        if (typeof ch.address !== 'number' || ch.address < 0 || ch.address > 65535) {
            fail(errors, where + ': некорректный адрес ' + ch.address);
        }

        var ev = parseErrorValue(ch.error_value);
        if (ch.error_value !== undefined) {
            if (ev === null) {
                fail(errors, where + ': error_value "' + ch.error_value + '" не разбирается');
            } else if (ev > 0 && !bitsFit(ev, ch.format)) {
                fail(errors, where + ': error_value ' + ch.error_value +
                    ' не помещается в ' + ch.format + ' (' + formatRange(ch.format) + ')');
            }
        }

        var words = regWords(ch);
        if (words >= 2 && !ch.word_order) {
            fail(errors, where + ': 32-битный регистр без word_order (по умолчанию big)');
        }
        if (words === 1 && ch.word_order) {
            fail(errors, where + ': word_order задан для 16-битного регистра, он не применяется');
        }
        if (ch.reg_type && ch.reg_type !== 'holding') {
            fail(errors, where + ': reg_type "' + ch.reg_type + '", шаблон проверен только для holding');
        }

        var key = ch.address;
        if (byAddr[key]) {
            fail(errors, where + ': адрес ' + ch.address + ' уже занят каналом ' + byAddr[key]);
        } else {
            byAddr[key] = where;
        }

        if (ch.scale !== undefined && (typeof ch.scale !== 'number' || ch.scale === 0)) {
            fail(errors, where + ': scale должен быть ненулевым числом');
        }
    });

    // Перекрытие регистров со сдвигом (u32 поверх двух следующих 16-битных)
    var list = dev.channels.slice().sort(function (a, b) { return a.address - b.address; });
    for (var i = 0; i < list.length - 1; i++) {
        var a = list[i];
        var b = list[i + 1];
        if (a.address + regWords(a) > b.address) {
            fail(errors, a.id + ' (' + a.address + ', ' + regWords(a) + ' рег.) перекрывает ' +
                b.id + ' (' + b.address + ')');
        }
    }

    var ranges = readRanges(dev.channels.map(function (ch) {
        return { id: ch.id, address: ch.address, format: ch.format };
    }), dev, errors);

    checkSpans(dev.channels, errors);

    var requests = ranges.length;
    console.log('шаблон: ' + file);
    console.log('каналов: ' + dev.channels.length + ', групп чтения: ' + requests +
        ', max_read_registers: ' + (dev.max_read_registers || DEFAULT_MAX_READ) +
        ', max_reg_hole: ' + (dev.max_reg_hole || 0));
    ranges.forEach(function (r) {
        console.log('  ' + r.start + '..' + (r.start + r.count - 1) + ' (' + r.count +
            ' рег.): ' + r.ids.join(', '));
    });

    if (errors.length) {
        errors.forEach(function (e) { console.log('FAIL ' + e); });
        return errors;
    }
    console.log('ok');
    return [];
}

// 32-битный регистр на последнем адресе Modbus-пространства читается двумя словами,
// второе из которых уже за пределами (65535) — устройство ответит ошибкой на весь запрос.
function checkSpans(channels, errors) {
    channels.forEach(function (ch) {
        if (ch.address + regWords(ch) - 1 > 65535) {
            errors.push(ch.id + ': регистр ' + ch.format + ' по адресу ' + ch.address +
                ' выходит за адресное пространство Modbus (0..65535)');
        }
    });
}

function bitsFit(v, fmt) {
    var bits = FORMATS[fmt].bytes * 8;
    if (FORMATS[fmt].signed) {
        var hi = Math.pow(2, bits - 1);
        return v < hi;
    }
    return v < Math.pow(2, bits);
}

module.exports = { check: check, readRanges: readRanges, regWords: regWords };

if (require.main === module) {
    var file = process.argv[2];
    if (!file) {
        console.error('usage: node tests/modbus-template-check.js <templates/config-*.json>');
        process.exit(2);
    }
    var errs = check(file);
    process.exit(errs.length ? 1 : 0);
}
