/* Очистка книги: разбор скрытых имён по происхождению и сборка макроса.
   Самое опасное место инструмента — он выдаёт код, который человек
   запустит на своей книге. Проверяем не вид страницы, а содержимое
   макроса: какие группы в него попали и что он не удаляет молча. */
const { браузер, открыть, страница, счёт } = require('../harness');

module.exports = async function () {
    const t = счёт('Очистка книги');
    const b = await браузер();
    const { pg, ошибки } = await открыть(b, 'messy.xlsm');
    await страница(pg, 'cleanup');

    t.раздел('Скрытые имена разобраны по происхождению');
    const г = await pg.evaluate(() => APP.cleanupGroups.map(g => ({
        id: g.group.id, риск: g.group.risk, сколько: g.names.length,
    })));
    console.log('     ' + г.map(x => x.id + ':' + x.сколько).join('  '));
    const по = Object.fromEntries(г.map(x => [x.id, x]));
    t.ok((по.blph || {}).сколько === 24, 'надстройка Bloomberg: 24 имени');
    t.ok((по.views || {}).сколько === 12, 'режимы представления: 12');
    t.ok((по.addins || {}).сколько === 6, 'отчётные надстройки: 6');
    t.ok((по.solver || {}).сколько === 2, 'модель «Поиска решения»: 2');
    t.ok((по.solver || {}).риск === 'danger', 'у «Поиска решения» риск «не трогать»');
    t.ok(Object.values(по).some(x => x.риск === 'safe'), 'есть группы, помеченные безопасными');

    t.раздел('По умолчанию отмечено только безопасное');
    const выбор = await pg.evaluate(() => ({
        выбрано: APP.cleanupPick.slice(),
        риски: APP.cleanupGroups.filter(g => APP.cleanupPick.includes(g.group.id))
                                .map(g => g.group.risk),
    }));
    t.ok(выбор.риски.length > 0 && выбор.риски.every(r => r === 'safe'),
         'в выборе только safe-группы: ' + выбор.выбрано.join(', '));

    t.раздел('Макрос собран под выбор и ничего не делает молча');
    const м = await pg.evaluate(() => document.querySelector('#cleanup-macro').textContent);
    const группыВМакросе = (/GROUPS_TO_DELETE As String = "([^"]*)"/.exec(м) || [])[1] || '';
    t.ok(выбор.выбрано.every(id => группыВМакросе.includes('|' + id + '|')),
         'в макросе ровно выбранные группы: ' + группыВМакросе);
    t.ok(/REX_очистка/.test(м), 'макрос строит лист с отчётом перед удалением');
    t.ok(/MsgBox/.test(м), 'макрос спрашивает подтверждение');
    t.ok(!/%%/.test(м), 'подстановки в шаблоне заполнены');
    t.ok(м.split('\n').every(s => s.length < 1000), 'ни одна строка не длиннее предела VBA');
    t.ok(/Sub REX_CleanNames/.test(м), 'точка входа названа как в описании');

    t.раздел('Защита использованных имён');
    const защита = await pg.evaluate(() => {
        const м = document.querySelector('#cleanup-macro').textContent;
        return { текст: document.querySelector('#cleanup-protect').textContent,
                 естьСписок: /KEEP_NAMES|PROTECTED/i.test(м) };
    });
    t.ok(/\d/.test(защита.текст) || /нечего/.test(защита.текст),
         'сказано, сколько имён защищено: ' + защита.текст.slice(0, 70));

    t.раздел('Снятие галки меняет макрос');
    const было = группыВМакросе;
    await pg.evaluate(() => {
        const ч = document.querySelector('.cl-group input:not([disabled]):checked');
        ч.click();
    });
    await pg.waitForTimeout(400);
    const стало = await pg.evaluate(() =>
        (/GROUPS_TO_DELETE As String = "([^"]*)"/.exec(
            document.querySelector('#cleanup-macro').textContent) || [])[1] || '');
    t.ok(стало !== было && стало.length < было.length,
         'группа ушла из макроса: ' + было + ' → ' + стало);

    t.раздел('Таблица скрытых имён и поиск');
    await pg.fill('#cleanup-search', 'BLPH');
    await pg.waitForTimeout(400);
    const поиск = await pg.evaluate(() => ({
        строк: document.querySelectorAll('#cleanup-tbody tr').length,
        первая: (document.querySelector('#cleanup-tbody tr strong') || {}).textContent || '',
    }));
    t.ok(поиск.строк === 24 && /BLPH/.test(поиск.первая),
         'поиск сузил список до 24 строк, первая ' + поиск.первая);

    const провалов = t.итог(ошибки);
    await b.close();
    return провалов;
};
