#!/usr/bin/env node
// Статическая проверка шаблона Modbus TCP для wb-mqtt-serial.
//
//   node tests/modbus-template-check.js templates/config-*.json
//
// Ловит то, что драйвер молча проглотит, а потом отдаст мусор в MQTT: дубли id,
// неверный word_order (драйвер понимает только "little_endian", остальное читает
// big-endian без предупреждения), error_value вне разрядности, перекрытия адресов,
// группу чтения длиннее max_read_registers.
// Код возврата 1, если найдена хотя бы одна проблема.

var fs = require('fs');

// src/register.h RegisterFormatFromName. Набор закрытый: неизвестное имя драйвер
// молча превращает в u16.
var FORMATS = {
    u8: { bytes: 1, signed: false },
    s8: { bytes: 1, signed: true },
    char8: { bytes: 1, signed: false, text: true },
    u16: { bytes: 2, signed: false },
    s16: { bytes: 2, signed: true },
    u24: { bytes: 3, signed: false },
    s24: { bytes: 3, signed: true },
    u32: { bytes: 4, signed: false },
    s32: { bytes: 4, signed: true },
    u64: { bytes: 8, signed: false },
    s64: { bytes: 8, signed: true },
    bcd8: { bytes: 1, signed: false },
    bcd16: { bytes: 2, signed: false },
    bcd24: { bytes: 3, signed: false },
    bcd32: { bytes: 4, signed: false },
    float: { bytes: 4, signed: true, real: true },
    double: { bytes: 8, signed: true, real: true },
    string: { bytes: 0, signed: false, text: true },
    string8: { bytes: 0, signed: false, text: true }
};

// src/modbus_device.cpp, ModbusRegisterTypes
var REG_TYPES = ['holding', 'holding_single', 'holding_multi', 'input', 'coil', 'discrete', 'press_counter'];

// MAX_READ_REGISTERS из src/modbus_common.h
var MAX_READ_REGISTERS = 125;
// Сколько регистров читает одна группа, если в шаблоне не задано max_read_registers
var DEFAULT_MAX_READ = 7;

// Единственное значение word_order, которое разбирает драйвер (src/register.h
// WordOrderFromName); всё остальное становится big-endian молча.
var WORD_ORDER_VALUE = 'little_endian';

function fail(errors, msg) {
    errors.push(msg);
}

function regWords(ch) {
    var f = FORMATS[ch.format];
    if (!f) return 1;      // о неизвестном формате уже сообщено отдельной ошибкой
    if (!f.bytes) return 1; // string* — длина переменная, считаем одно слово
    return Math.ceil(f.bytes / 2);
}

function formatRange(fmt) {
    var bits = FORMATS[fmt].bytes * 8;
    if (FORMATS[fmt].signed) {
        var hi = Math.pow(2, bits - 1) - 1;
        return -hi - 1 + '..' + hi;
    }
    return '0..' + Math.pow(2, bits) - 1;
}

// error_value в шаблоне — строка "0xFFFF" или число; null — не разбирается
function parseErrorValue(v) {
    if (v === undefined || v === null) return null;
    if (typeof v === 'number') return v;
    var s = String(v).trim();
    if (/^0x[0-9a-fA-F]+$/.test(s)) return parseInt(s, 16);
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    return null;
}

// Группировка регистров по правилам src/modbus_common.cpp TModbusRegisterRange::AddRegister:
// регистр добавляется в текущий диапазон, если отделён дырой не больше max_reg_hole и
// диапазон после этого не длиннее max_read_registers. Регистры просматриваются по
// возрастанию адреса — AddRegister отклоняет всё, что ниже начала диапазона.
function readRanges(channels, device) {
    var regs = [];
    channels.forEach(function (ch) {
        regs.push({ addr: ch.address, words: regWords(ch), id: ch.id });
    });
    regs.sort(function (a, b) { return a.addr - b.addr || a.words - b.words; });

    var maxHole = device.max_reg_hole || 0;
    var maxRead = device.max_read_registers || DEFAULT_MAX_READ;
    if (maxRead > MAX_READ_REGISTERS) maxRead = MAX_READ_REGISTERS;

    var ranges = [];
    var current = null;
    regs.forEach(function (r) {
        if (current) {
            if (r.addr >= current.start && r.addr + r.words <= current.start + current.count) {
                current.ids.push(r.id); // регистр внутри уже читаемого диапазона
                return;
            }
            if (r.addr >= current.start &&
                current.start + current.count + maxHole >= r.addr &&
                r.addr + r.words - current.start <= maxRead) {
                current.count = Math.max(current.count, r.addr + r.words - current.start);
                current.ids.push(r.id);
                return;
            }
        }
        current = { start: r.addr, count: r.words, ids: [r.id] };
        ranges.push(current);
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
    if (dev.max_read_registers !== undefined && dev.max_read_registers > MAX_READ_REGISTERS) {
        fail(errors, 'max_read_registers=' + dev.max_read_registers +
            ' больше предела Modbus ' + MAX_READ_REGISTERS + ': драйвер его не применит');
    }

    var maxRead = dev.max_read_registers || DEFAULT_MAX_READ;
    if (maxRead > MAX_READ_REGISTERS) maxRead = MAX_READ_REGISTERS;

    var byId = {};
    var byAddr = {};

    dev.channels.forEach(function (ch) {
        var where = (ch.id || ch.name || '?');

        if (!ch.id) fail(errors, where + ': нет id');
        else if (byId[ch.id] !== undefined) fail(errors, 'дубль id: ' + ch.id);
        else byId[ch.id] = ch.address;

        if (!FORMATS[ch.format]) {
            fail(errors, where + ': неизвестный формат "' + ch.format + '" (драйвер молча прочитает u16)');
            return;
        }
        if (typeof ch.address !== 'number' || ch.address < 0 || ch.address > 65535) {
            fail(errors, where + ': некорректный адрес ' + ch.address);
            return;
        }
        if (ch.address + regWords(ch) - 1 > 65535) {
            fail(errors, where + ': регистр ' + ch.format + ' по адресу ' + ch.address +
                ' выходит за адресное пространство Modbus (0..65535)');
        }

        if (ch.reg_type && REG_TYPES.indexOf(ch.reg_type) < 0) {
            fail(errors, where + ': неизвестный reg_type "' + ch.reg_type + '"');
        }

        var ev = parseErrorValue(ch.error_value);
        if (ch.error_value !== undefined) {
            if (ev === null) {
                fail(errors, where + ': error_value "' + ch.error_value + '" не разбирается');
            } else if (!FORMATS[ch.format].text && ev > 0 && !bitsFit(ev, ch.format)) {
                fail(errors, where + ': error_value ' + ch.error_value +
                    ' не помещается в ' + ch.format + ' (' + formatRange(ch.format) + ')');
            }
        }

        var words = regWords(ch);
        if (words >= 2 && !ch.word_order) {
            fail(errors, where + ': 32-битный регистр без word_order (драйвер прочитает big-endian)');
        } else if (ch.word_order && ch.word_order !== WORD_ORDER_VALUE) {
            fail(errors, where + ': word_order "' + ch.word_order + '" — драйвер понимает только "' +
                WORD_ORDER_VALUE + '", остальное молча читается big-endian');
        } else if (words === 1 && ch.word_order) {
            fail(errors, where + ': word_order задан для 16-битного регистра, он не применяется');
        }

        if (byAddr[ch.address] !== undefined) {
            fail(errors, where + ': адрес ' + ch.address + ' уже занят каналом ' + byAddr[ch.address]);
        } else {
            byAddr[ch.address] = where;
        }

        if (ch.scale !== undefined && (typeof ch.scale !== 'number' || ch.scale === 0)) {
            fail(errors, where + ': scale должен быть ненулевым числом');
        }
    });

    // Перекрытие регистров со сдвигом: 32-битный канал поверх соседнего 16-битного.
    // Совпадение стартовых адресов сюда не входит — оно уже поймано выше.
    var list = dev.channels.filter(function (ch) { return FORMATS[ch.format]; })
        .sort(function (a, b) { return a.address - b.address; });
    for (var i = 0; i < list.length - 1; i++) {
        var a = list[i];
        var b = list[i + 1];
        if (a.address !== b.address && a.address + regWords(a) > b.address) {
            fail(errors, a.id + ' (' + a.address + ', ' + regWords(a) + ' рег.) перекрывает ' +
                b.id + ' (' + b.address + ')');
        }
    }

    var ranges = readRanges(dev.channels.filter(function (ch) {
        return FORMATS[ch.format];
    }), dev);

    var covered = {};
    ranges.forEach(function (r) {
        r.ids.forEach(function (id) { covered[id] = true; });
        if (r.count > maxRead) {
            fail(errors, 'группа ' + r.start + '..' + (r.start + r.count - 1) + ' (' + r.count +
                ' рег.) длиннее max_read_registers=' + maxRead);
        }
    });
    dev.channels.forEach(function (ch) {
        if (FORMATS[ch.format] && !covered[ch.id]) {
            fail(errors, ch.id + ': не попал ни в одну группу чтения');
        }
    });

    console.log('шаблон: ' + file);
    console.log('каналов: ' + dev.channels.length + ', групп чтения: ' + ranges.length +
        ', max_read_registers: ' + maxRead + ', max_reg_hole: ' + (dev.max_reg_hole || 0));
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

function bitsFit(v, fmt) {
    var bits = FORMATS[fmt].bytes * 8;
    if (FORMATS[fmt].signed) {
        return v < Math.pow(2, bits - 1);
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
