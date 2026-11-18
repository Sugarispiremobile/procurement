// Сценарий ТЗ (раздел 9): сотрудник подаёт → снабжение берёт → комментарий → файл → выполнено.
import { test, expect } from '@playwright/test';

const PASSWORD = 'demo12345';

async function login(page, email) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('link', { name: 'Заявки', exact: true })).toBeVisible();
}

test('заявка проходит путь от подачи до «Выполнена»', async ({ browser }) => {
  const item = `Монитор E2E ${Date.now()}`;
  const employee = await (await browser.newContext()).newPage();
  const buyer = await (await browser.newContext()).newPage();

  // 1. Сотрудник подаёт заявку
  await login(employee, 'anna@example.com');
  await employee.getByRole('link', { name: '+ Новая заявка' }).click();
  await employee.getByLabel('Категория').selectOption({ index: 1 });
  await employee.getByLabel('Наименование').fill(item);
  await employee.getByLabel('Обоснование').fill('Нужен для работы (E2E)');
  await employee.getByRole('button', { name: 'Отправить заявку' }).click();
  await expect(employee).toHaveURL(/\/requests\/\d+$/);
  const requestUrl = employee.url();
  await expect(employee.getByText('Новая').first()).toBeVisible();

  // 2. Снабжение берёт заявку в работу
  await login(buyer, 'buyer@example.com');
  await buyer.goto(requestUrl);
  await buyer.getByRole('button', { name: 'Взять в работу' }).click();
  await expect(buyer.getByRole('button', { name: 'Взять в работу' })).toBeHidden();

  // 3. Комментарий снабжения виден сотруднику
  await buyer.getByLabel('Новый комментарий').fill('Уточните, пожалуйста, модель');
  await buyer.getByRole('button', { name: 'Отправить', exact: true }).click();
  await employee.reload();
  await expect(employee.getByText('Уточните, пожалуйста, модель')).toBeVisible();

  // 4. Сотрудник прикрепляет файл (по сигнатуре это PDF)
  await employee.locator('input[type=file]').setInputFiles({
    name: 'invoice.pdf', mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n'),
  });
  await expect(employee.getByText('invoice.pdf')).toBeVisible();

  // 5. Снабжение ведёт заявку до «Выполнена»
  await buyer.reload();
  await expect(buyer.getByText('invoice.pdf')).toBeVisible();
  for (const next of [/→ .*согласован/i, /→ .*закупк/i, /→ .*Выполн/i]) {
    await buyer.getByRole('button', { name: next }).click();
  }
  await employee.reload();
  await expect(employee.getByText('Выполнена').first()).toBeVisible();
  await expect(employee.getByText(item)).toBeVisible();
});

test('снабжение отклоняет заявку только с причиной', async ({ browser }) => {
  const employee = await (await browser.newContext()).newPage();
  const buyer = await (await browser.newContext()).newPage();
  await login(employee, 'anna@example.com');
  await employee.goto('/requests/new');
  await employee.getByLabel('Категория').selectOption({ index: 1 });
  await employee.getByLabel('Наименование').fill('Проектор E2E');
  await employee.getByLabel('Обоснование').fill('Для переговорной');
  await employee.getByRole('button', { name: 'Отправить заявку' }).click();
  await expect(employee).toHaveURL(/\/requests\/\d+$/);
  const url = employee.url();

  await login(buyer, 'buyer@example.com');
  await buyer.goto(url);
  await buyer.getByRole('button', { name: 'Отклонить…' }).click();
  await buyer.getByLabel(/Причина отклонения/).fill('Нет бюджета в этом квартале');
  await buyer.getByRole('button', { name: 'Отклонить заявку' }).click();

  await employee.reload();
  await expect(employee.getByText('Отклонена').first()).toBeVisible();
  await expect(employee.getByText('Нет бюджета в этом квартале')).toBeVisible();
});
