/* Разбор по колонкам: находит колонку, в которой протянутую формулу
   подменили руками. Ради этого раздел и писался — такую подмену в Excel
   не видно, она не ошибка и ни на что не жалуется. */
const { браузер, открыть, страница, счёт } = require('../harness');

module.exports = async function () {
    const t = счёт('Разбор по колонкам');
    const b = await браузер();
    const { pg, ошибки } = await открыть(b, 'messy.xlsm');
    await страница(pg, 'formulas');
    await pg.waitForTimeout(500);

    t.раздел('Колонка с подменой опознана как рваная');
    const к = await pg.evaluate(() => {
        const лист = APP.books[0].sheets.find(s => s.name === 'Договоры');
        return (лист.columns || []).map(c => ({
            буква: c.letter, вид: c.kind, формул: c.formulas,
            разрывов: (c.gaps || []).length, шаблонов: c.distinct,
        }));
    });
    console.log('     ' + к.map(x => x.буква + ':' + x.вид + '/' + x.разрывов).join('  '));
    const D = к.find(x => x.буква === 'D');
    t.ok(D && D.вид === 'torn', 'колонка D помечена рваной: ' + (D || {}).вид);
    t.ok(D && D.разрывов === 3, 'найдены все три подмены: ' + (D || {}).разрывов);
    t.ok(к.filter(x => x.вид === 'even').length >= 0, 'остальные колонки разобраны');

    t.раздел('Правило качества указывает на то же место');
    const пр = await pg.evaluate(() => {
        const i = APP.issues.find(x => x.id === 'col-gap');
        return i ? { счёт: i.count, адреса: i.items.map(x => x.loc) } : null;
    });
    t.ok(пр && пр.счёт === 1, 'правило «вбито руками» сработало один раз');
    t.ok(пр && пр.адреса.some(a => /Договоры/.test(a)),
         'адрес указывает на нужный лист: ' + (пр || {}).адреса);

    t.раздел('Таблица разбора отрисована');
    const вид = await pg.evaluate(() => ({
        строк: document.querySelectorAll('#col-tbody tr').length,
        чипов: document.querySelectorAll('.col-kind').length,
        подсказка: !!document.querySelector('#col-why .ib'),
    }));
    t.ok(вид.строк > 0, 'строки разбора на месте: ' + вид.строк);
    t.ok(вид.чипов === 4, 'четыре чипа: все колонки и три вида');
    t.ok(вид.подсказка, 'у заголовка есть (i) с объяснением слова «порвали»');

    t.раздел('Фильтр по виду колонок');
    const было = вид.строк;
    await pg.evaluate(() => {
        const кн = [...document.querySelectorAll('.col-kind')].find(b => b.dataset.kind === 'torn');
        кн.click();
    });
    await pg.waitForTimeout(400);
    const стало = await pg.evaluate(() => document.querySelectorAll('#col-tbody tr').length);
    t.ok(стало >= 1 && стало <= было, 'фильтр «рваные» сузил список: ' + было + ' → ' + стало);

    const провалов = t.итог(ошибки);
    await b.close();
    return провалов;
};
