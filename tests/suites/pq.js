/* Power Query: запросы достаются из DataMashup, источники опознаются по
   виду, цепочки запрос → запрос прослеживаются. Это единственное место,
   где REX читает не XML, а zip внутри base64 внутри XML, — ломается оно
   молча, поэтому проверяем по существу, а не по факту «что-то нашлось». */
const { браузер, открыть, страница, счёт } = require('../harness');

module.exports = async function () {
    const t = счёт('Power Query');
    const b = await браузер();
    const { pg, ошибки } = await открыть(b, 'pq.xlsx');

    t.раздел('Запросы прочитаны');
    const q = await pg.evaluate(() => (APP.books[0].queries || []).map(x => ({
        имя: x.name, источников: (x.sources || []).length,
        виды: (x.sources || []).map(s => s.kind).sort(),
        шагов: (x.steps || []).length,
    })));
    console.log('     ' + q.map(x => x.имя + '(' + x.шагов + ')').join('  '));
    t.ok(q.length === 8, 'найдены все восемь запросов: ' + q.length);
    t.ok(q.every(x => x.шагов >= 2), 'у каждого запроса разобраны шаги');

    t.раздел('Источники опознаны по виду');
    const виды = {};
    await pg.evaluate(() => (APP.books[0].queries || []).flatMap(x => x.sources || []))
        .then(src => src.forEach(s => { виды[s.kind] = (виды[s.kind] || 0) + 1; }));
    console.log('     ' + JSON.stringify(виды));
    ['file', 'folder', 'db', 'web'].forEach(k =>
        t.ok(виды[k] >= 1, 'источник вида «' + k + '» распознан: ' + (виды[k] || 0)));

    t.раздел('Цепочка запрос → запрос');
    const цепь = await pg.evaluate(() => {
        const свод = APP.graph.nodes.find(n => n.type === 'query' && /сводно/.test(n.label));
        if (!свод) return null;
        const входящие = APP.graph.edges.filter(e => e.target === свод.id && e.type === 'feed');
        return { имя: свод.label, питают: входящие.length };
    });
    t.ok(цепь && цепь.питают >= 2,
         'запрос, собранный из двух других, виден в графе: питают ' + (цепь || {}).питают);

    t.раздел('Запрос, который никуда не грузится');
    const мёртвый = await pg.evaluate(() =>
        (APP.issues.find(i => i.id === 'dead-queries') || {}).count || 0);
    t.ok(мёртвый >= 1, 'правило о ненужных запросах сработало: ' + мёртвый);

    t.раздел('Раздел отрисован');
    await страница(pg, 'pq');
    const вид = await pg.evaluate(() => ({
        карточек: document.querySelectorAll('#pq-content .card').length,
        мКод: document.querySelectorAll('.pq-step-expr').length,
        значкиИсточников: document.querySelectorAll('#pq-content .node-glyph, #pq-content .src-ic').length,
        кнопкаВыгрузки: !document.querySelector('#btn-export-m').disabled,
    }));
    console.log('     ' + JSON.stringify(вид));
    t.ok(вид.карточек >= 8, 'по карточке на запрос: ' + вид.карточек);
    t.ok(вид.мКод > 0, 'M-код шагов показан');
    t.ok(вид.кнопкаВыгрузки, 'выгрузка M-кода доступна');

    const провалов = t.итог(ошибки);
    await b.close();
    return провалов;
};
