// Тест статической проверки шаблонов Modbus TCP.
//   node tests/modbus-template-check.test.js
//
// Проверяющий скрипт — тоже код, и он обязан ловить дефекты на заведомо плохих шаблонах.
// Каждый случай проверяется assert'ом: ошибочный шаблон должен дать FAIL с ожидаемым текстом.

var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var checker = require('./modbus-template-check.js');

var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-check-'));
var passed = 0;

function writeTemplate(name, obj) {
    var p = path.join(tmpDir, name);
    fs.writeFileSync(p, JSON.stringify(obj));
    return p;
}

function baseDevice(channels, extra) {
    var dev = { name: 'Test', id: 'test', max_read_registers: 7, channels: channels };
    for (var k in (extra || {})) dev[k] = extra[k];
    return { device_type: 'test-device', device: dev };
}

function expectErrors(name, obj, pattern) {
    var errs = checker.check(writeTemplate(name, obj));
    assert(errs.length > 0, name + ': ожидалась ошибка, а проверка прошла');
    assert(errs.some(function (e) { return pattern.test(e); }),
        name + ': нет ошибки по /' + pattern.source + '/, получено: ' + errs.join(' | '));
    passed++;
}

function expectOk(name, obj) {
    var errs = checker.check(writeTemplate(name, obj));
    assert.strictEqual(errs.length, 0, name + ': неожиданные ошибки: ' + errs.join(' | '));
    passed++;
}

var ch = function (id, addr, fmt, extra) {
    var c = { name: id, id: id, reg_type: 'holding', address: addr, format: fmt, readonly: true };
    for (var k in (extra || {})) c[k] = extra[k];
    return c;
};

// --- хорошие шаблоны -------------------------------------------------------
expectOk('good.json', baseDevice([
    ch('a', 771, 's16', { scale: 0.01, error_value: '0x7FFF' }),
    ch('b', 772, 's16', { scale: 0.1, error_value: '0x7FFF' }),
    ch('c', 780, 'u32', { scale: 0.01, word_order: 'little', error_value: '0xFFFFFFFF' })
]));

// дыра до max_reg_hole склеивает регистры в одну группу
var glued = {
    device_type: 't', device: { id: 't', max_read_registers: 7, max_reg_hole: 3, channels: [
        ch('a', 100, 'u16'), ch('b', 103, 'u16')
    ] }
};
assert.strictEqual(checker.readRanges(glued.device.channels, glued.device).length, 1,
    'дыра в 3 регистра должна склеивать группу');
passed++;

// --- дефекты ---------------------------------------------------------------
expectErrors('dup-id.json', baseDevice([
    ch('a', 100, 'u16'), ch('a', 101, 'u16')
]), /дубль id/);

expectErrors('dup-addr.json', baseDevice([
    ch('a', 100, 'u16'), ch('b', 100, 'u16')
]), /адрес 100 уже занят/);

expectErrors('bad-format.json', baseDevice([
    ch('a', 100, 'float32')
]), /неизвестный формат/);

expectErrors('errval-overflow.json', baseDevice([
    ch('a', 100, 's16', { error_value: '0xFFFF' })
]), /не помещается/);

expectErrors('errval-garbage.json', baseDevice([
    ch('a', 100, 'u16', { error_value: 'нет данных' })
]), /не разбирается/);

expectErrors('wide-no-word-order.json', baseDevice([
    ch('a', 100, 'u32')
]), /word_order/);

expectErrors('overlap.json', baseDevice([
    ch('a', 100, 'u32', { word_order: 'little' }), ch('b', 101, 'u16')
]), /перекрывает/);

expectErrors('max-read-too-long.json', baseDevice([
    ch('a', 100, 'u16')
], { max_read_registers: 150 }), /max_read_registers/);

expectErrors('hole-too-long.json', {
    device_type: 't', device: { id: 't', max_reg_hole: 40, channels: [ch('a', 100, 'u16')] }
}, /max_reg_hole/);

expectErrors('empty.json', { device_type: 't', device: { id: 't', channels: [] } }, /нет device.channels/);

// --- реальные шаблоны в репозитории ---------------------------------------
['templates/config-victron-solarcharger.json', 'templates/config-victron-venus-system.json']
    .forEach(function (f) {
        var errs = checker.check(path.join(__dirname, '..', f));
        assert.strictEqual(errs.length, 0, f + ': ' + errs.join(' | '));
        passed++;
    });

console.log('ok ' + passed + ' проверок');
process.exit(0);
