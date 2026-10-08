/* Конвертер форматов.

   Настоящую папку в проверке не выберешь: showDirectoryPicker открывает
   системный диалог и требует жеста человека. Поэтому подменяем сам
   источник — отдаём странице папку, живущую в памяти, с теми же методами,
   что у File System Access API. Код конвертера при этом работает честно:
   читает байты, гоняет их через SheetJS и пишет результат — просто пишет
   не на диск, а в наш объект, где мы его и проверяем. */
const fs = require('fs');
const path = require('path');
const { браузер, страница, счёт } = require('../harness');

const КНИГИ = path.join(__dirname, '..', 'fixtures');

/** Папка в памяти: { 'имя.xlsx': Uint8Array, 'подпапка': {…} } */
function поддельнаяФС(страницаPw, дерево) {
    return страницаPw.evaluate(дерево => {
        const вБайты = x => new Uint8Array(x);
        function папка(имя, содержимое) {
            const h = {
                kind: 'directory', name: имя, _дети: содержимое,
                async *entries() {
                    for (const [к, v] of Object.entries(h._дети)) {
                        yield [к, v && v.__файл ? файл(к, v.данные) : папка(к, v)];
                    }
                },
                async getFileHandle(имя, opts) {
                    if (!h._дети[имя]) {
                        if (!opts || !opts.create) throw new Error('нет такого файла');
                        h._дети[имя] = { __файл: true, данные: [] };
                    }
                    return файл(имя, h._дети[имя].данные, h);
                },
                async removeEntry(имя) {
                    if (!h._дети[имя]) throw new Error('нечего удалять');
                    delete h._дети[имя];
                },
            };
            return h;
        }
        function файл(имя, данные, родитель) {
            return {
                kind: 'file', name: имя, __файл: true,
                async getFile() {
                    const b = vбайты(данные);
                    return { size: b.length, arrayBuffer: async () => b.buffer };
                },
                async createWritable() {
                    return {
                        async write(x) { родитель._дети[имя] = { __файл: true, данные: Array.from(вБайты(x)) }; },
                        async close() {},
                    };
                },
            };
        }
        const vбайты = д => new Uint8Array(д);
        window.__фс = папка('Отчёты', дерево);
        window.__дерево = дерево;
        window.showDirectoryPicker = async () => window.__фс;
        return true;
    }, дерево);
}

module.exports = async function () {
    const t = счёт('Конвертер форматов');
    const b = await браузер();
    const pg = await b.newPage({ viewport: { width: 1450, height: 950 } });
    const ошибки = [];
    pg.on('pageerror', e => ошибки.push('PAGEERROR ' + e.message));
    pg.on('console', m => {
        const x = m.text();
        if (m.type() === 'error' && !/ERR_|net::/.test(x)) ошибки.push(x.slice(0, 180));
    });
    await pg.goto('file://' + path.join(__dirname, '..', 'build', 'app.html'));
    await pg.waitForFunction(() => typeof APP !== 'undefined' && typeof CONV_FORMATS !== 'undefined',
                             null, { timeout: 30000 });
    await страница(pg, 'convert');

    t.раздел('Раздел доступен сразу, без загруженной книги');
    const д = await pg.evaluate(() => ({
        книгЗагружено: APP.books.length,
        пунктАктивен: !document.querySelector('.nav-item[data-page="convert"]').disabled,
        чипов: document.querySelectorAll('#cv-from .cv-chip').length,
        целей: [...document.querySelectorAll('#cv-to option')].map(o => o.value),
        удалятьВыкл: !document.querySelector('#cv-drop').checked,
        предупреждение: document.querySelector('#cv-warn').innerText.trim(),
    }));
    t.ok(д.книгЗагружено === 0 && д.пунктАктивен, 'конвертер работает без разбора книги');
    t.ok(д.чипов === 5, 'пять исходных форматов: ' + д.чипов);
    t.ok(д.целей.indexOf('xlsm') === -1, 'XLSM не предлагается как цель: макросы всё равно теряются');
    t.ok(д.удалятьВыкл, 'удаление исходников по умолчанию выключено');
    t.ok(/конвертация, а не переименование/i.test(д.предупреждение),
         'предупреждение о потерях на виду, а не под кликом');

    t.раздел('Папка читается вглубь, лишнее отсеивается');
    const байты = Array.from(fs.readFileSync(path.join(КНИГИ, 'clean.xlsx')));
    await поддельнаяФС(pg, {
        'Бюджет.xlsx': { __файл: true, данные: байты },
        '~$Бюджет.xlsx': { __файл: true, данные: байты },   // замок открытой книги
        'заметки.txt': { __файл: true, данные: [1, 2, 3] },
        '2025': {
            'Март.xlsx': { __файл: true, данные: байты },
            'Апрель.xlsb': { __файл: true, данные: байты },
        },
    });
    await pg.click('#cv-pick');
    await pg.waitForFunction(() => CONV.root !== null, null, { timeout: 15000 });
    await pg.waitForTimeout(300);
    const с = await pg.evaluate(() => ({
        найдено: CONV.found.map(f => f.path).sort(),
        кКонвертации: CONV.picked.map(f => f.path).sort(),
        строк: document.querySelectorAll('#cv-rows tr').length,
        сводка: document.querySelector('#cv-sum').textContent,
    }));
    console.log('     ' + JSON.stringify(с.найдено));
    t.ok(с.найдено.length === 3, 'обошли вложенные папки, нашли три таблицы: ' + с.найдено.length);
    t.ok(!с.найдено.some(p => /~\$/.test(p)), 'временный файл Excel (~$) пропущен');
    t.ok(!с.найдено.some(p => /\.txt$/.test(p)), 'не-таблицы не взяты');
    t.ok(с.кКонвертации.length === 2 && !с.кКонвертации.some(p => /\.xlsb$/.test(p)),
         'файл, уже лежащий в целевом формате, в работу не попал: ' + JSON.stringify(с.кКонвертации));
    t.ok(с.строк === 2, 'в таблице ровно отобранные строки');

    t.раздел('Конвертация доходит до файла, и его можно прочитать обратно');
    await pg.click('#cv-run');
    await pg.waitForFunction(() => !CONV.busy && !document.querySelector('#cv-done').hidden,
                             null, { timeout: 120000 });
    const р = await pg.evaluate(async () => {
        const дерево = window.__дерево;
        const новый = дерево['Бюджет.xlsb'];
        let листы = null, значение = null;
        if (новый) {
            const wb = XLSX.read(new Uint8Array(новый.данные), { type: 'array' });
            листы = wb.SheetNames;
            const л = wb.Sheets[wb.SheetNames[0]];
            значение = (л['A1'] || {}).v;
        }
        return {
            итог: document.querySelector('#cv-done').innerText.replace(/\n/g, ' · '),
            плохо: document.querySelector('#cv-done').classList.contains('bad'),
            корень: Object.keys(дерево).sort(),
            вложенная: Object.keys(дерево['2025']).sort(),
            листыНового: листы, перваяЯчейка: значение,
            исходникНаМесте: !!дерево['Бюджет.xlsx'],
        };
    });
    console.log('     ' + JSON.stringify(р.корень) + '  ' + JSON.stringify(р.вложенная));
    t.ok(!р.плохо, 'обошлось без ошибок: ' + р.итог);
    t.ok(р.корень.indexOf('Бюджет.xlsb') !== -1 && р.вложенная.indexOf('Март.xlsb') !== -1,
         'оба файла записаны рядом с исходными, в своих папках');
    t.ok(р.исходникНаМесте, 'исходник не тронут: галку удаления не ставили');
    t.ok(р.листыНового && р.листыНового.join() === 'Расчёт,Свод',
         'в новом файле те же листы: ' + (р.листыНового || []).join(', '));
    t.ok(р.перваяЯчейка === 'Статья', 'значения доехали: A1 = ' + р.перваяЯчейка);

    t.раздел('Повторная конвертация: пропускает уже сделанное');
    await pg.click('#cv-pick');
    await pg.waitForFunction(() => CONV.root !== null, null, { timeout: 15000 });
    await pg.waitForTimeout(300);
    await pg.click('#cv-run');
    await pg.waitForFunction(() => !CONV.busy && !document.querySelector('#cv-done').hidden,
                             null, { timeout: 120000 });
    const п = await pg.evaluate(() => ({
        итог: document.querySelector('#cv-done').innerText.replace(/\n/g, ' · '),
        состояния: [...document.querySelectorAll('#cv-rows .cv-state')].map(c => c.className),
    }));
    t.ok(/пропущено/.test(п.итог), 'во второй раз файлы пропущены: ' + п.итог);
    t.ok(п.состояния.every(c => /skip/.test(c)), 'все строки помечены как пропущенные');

    t.раздел('Удаление исходника: только по галке и после подтверждения');
    pg.on('dialog', d => d.accept());
    await pg.evaluate(() => { document.querySelector('#cv-skip').checked = false; });
    await pg.click('#cv-drop');
    await pg.click('#cv-pick');
    await pg.waitForFunction(() => CONV.root !== null, null, { timeout: 15000 });
    await pg.waitForTimeout(300);
    await pg.click('#cv-run');
    await pg.waitForFunction(() => !CONV.busy && !document.querySelector('#cv-done').hidden,
                             null, { timeout: 120000 });
    const у = await pg.evaluate(() => ({
        корень: Object.keys(window.__дерево).sort(),
        вложенная: Object.keys(window.__дерево['2025']).sort(),
    }));
    console.log('     ' + JSON.stringify(у.корень));
    t.ok(у.корень.indexOf('Бюджет.xlsx') === -1, 'исходник удалён, когда галка стоит');
    t.ok(у.корень.indexOf('Бюджет.xlsb') !== -1, 'результат на месте');
    t.ok(у.корень.indexOf('~$Бюджет.xlsx') !== -1, 'временный файл не трогали');

    const провалов = t.итог(ошибки);
    await b.close();
    return провалов;
};
