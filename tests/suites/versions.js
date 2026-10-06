/* Две книги: область просмотра, сравнение версий, режим различий на графе
   и удаление лишней книги. Область — сквозная вещь: стоит ей сломаться, и
   разделы начинают показывать смесь из двух файлов, не говоря об этом. */
const { браузер, открыть, страница, счёт } = require('../harness');

module.exports = async function () {
    const t = счёт('Версии и область просмотра');
    const b = await браузер();
    const { pg, ошибки } = await открыть(b, ['v1.xlsx', 'v2.xlsx']);

    t.раздел('Загрузились обе, показывается ровно одна');
    const о = await pg.evaluate(() => ({
        книг: APP.books.length, область: APP.scope,
        именаКниг: APP.books.map(b => b.fileName),
        узловВсего: APP.graph.nodes.length,
        узловНаХолсте: window.__cy ? window.__cy.nodes().length : 0,
    }));
    console.log('     ' + JSON.stringify(о));
    t.ok(о.книг === 2, 'обе книги разобраны');
    t.ok(Number.isInteger(о.область), 'область указывает на конкретную книгу: ' + о.область);
    t.ok(о.узловНаХолсте > 0 && о.узловНаХолсте < о.узловВсего,
         'на холсте объекты одной книги, а не обеих: ' + о.узловНаХолсте + ' из ' + о.узловВсего);

    t.раздел('Переключение области меняет то, что видно');
    const переключение = await pg.evaluate(async () => {
        const снять = () => ({
            книга: (APP.books[APP.scope] || {}).fileName,
            листы: APP.books[APP.scope].sheets.map(s => s.name),
        });
        APP.scope = 0; rebuildDerived(); renderAll();
        await new Promise(r => setTimeout(r, 600));
        const первая = снять();
        APP.scope = 1; rebuildDerived(); renderAll();
        await new Promise(r => setTimeout(r, 600));
        return { первая, вторая: снять() };
    });
    t.ok(переключение.первая.листы.includes('Свод 2025'), 'в первой версии лист «Свод 2025»');
    t.ok(переключение.вторая.листы.includes('Свод 2026'), 'во второй он уже «Свод 2026»');
    t.ok(переключение.вторая.листы.includes('Прогноз'), 'во второй появился лист «Прогноз»');

    t.раздел('Сравнение версий');
    await страница(pg, 'diff');
    const д = await pg.evaluate(() => {
        const d = APP.diff || {};
        const текст = document.querySelector('#diff-content').innerText;
        return { всего: d.всего, текст };
    });
    t.ok(д.всего > 0, 'отличия посчитаны: ' + д.всего);
    t.ok(/Свод 2026|Прогноз/.test(д.текст), 'переименование и новый лист попали в отчёт');
    t.ok(/Админ_расход/.test(д.текст), 'пропавшее имя названо');
    t.ok(/B2-C2\*1\.2/.test(д.текст), 'изменённая формула показана как было → стало');
    t.ok(/Части файла/.test(д.текст), 'сверка частей архива дошла до отчёта');

    t.раздел('Различия на графе');
    await страница(pg, 'graph');
    await pg.waitForFunction(() => window.__cy && window.__cy.nodes().length > 0);
    const р = await pg.evaluate(async () => {
        const ч = document.querySelector('#opt-diff');
        if (!ч || ч.disabled) return { доступно: false };
        ч.click();
        await new Promise(r => setTimeout(r, 1200));
        // Кольцо не бордюр cytoscape, а часть картинки узла: оно вшито в
        // data-URI иконки, потому что бордюр здесь умеет только прямоугольник.
        const сКольцом = window.__cy.nodes().filter(n =>
            String(n.data('icon') || '').indexOf(encodeURIComponent(DIFF_RING)) !== -1);
        return {
            доступно: true,
            включено: APP.diffOnGraph,
            панель: (document.querySelector('.graph-details') || {}).innerText || '',
            помеченных: сКольцом.length,
        };
    });
    t.ok(р.доступно && р.включено, 'режим различий включается на паре книг');
    t.ok(р.помеченных > 0, 'отличившиеся объекты помечены рамкой: ' + р.помеченных);
    t.ok(/появил|пропал|измен/i.test(р.панель), 'разбор отличий ушёл в правую панель, а не в легенду');

    t.раздел('Удаление книги');
    await страница(pg, 'upload');
    const у = await pg.evaluate(async () => {
        const былоИмя = (APP.books[APP.scope] || {}).fileName;
        dropBook(0);
        await new Promise(r => setTimeout(r, 1500));
        return {
            книг: APP.books.length, область: APP.scope,
            показываем: (APP.books[APP.scope] || {}).fileName, былоИмя,
            узлов: window.__cy ? window.__cy.nodes().length : 0,
            сравнениеГаснет: document.querySelector('.nav-item[data-page="diff"]').disabled,
        };
    });
    console.log('     ' + JSON.stringify(у));
    t.ok(у.книг === 1 && у.область === 0, 'осталась одна книга, область на неё и указывает');
    t.ok(у.показываем === у.былоИмя, 'смотрим ту же книгу, что и до удаления: ' + у.показываем);
    t.ok(у.узлов > 0, 'граф пересобрался, а не опустел');
    t.ok(у.сравнениеГаснет, '«Сравнение версий» погасло: сравнивать больше не с чем');

    const провалов = t.итог(ошибки);
    await b.close();
    return провалов;
};
