import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createJobDescriptionSchema,
  updateJobDescriptionSchema,
  MAX_DESCRIPTION_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_COMPANY_NAME_LENGTH,
} from './job-description.controller';

const valid = { title: 'Frontend Developer', companyName: 'Example Technologies', descriptionText: 'We need React.' };

const issueFields = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  (result.error?.issues ?? []).map((issue) => issue.path.join('.'));

test('create: trims title and company name, keeps the description exactly as entered', () => {
  const description = '  Requirements:\n\n- React  \n';
  const result = createJobDescriptionSchema.parse({
    title: '  Frontend Developer  ',
    companyName: '  Example Technologies ',
    descriptionText: description,
  });
  assert.deepEqual(result, { title: 'Frontend Developer', companyName: 'Example Technologies', descriptionText: description });
});

test('create: company name is optional and blank means none', () => {
  for (const companyName of [undefined, null, '', '   ']) {
    const result = createJobDescriptionSchema.parse({ ...valid, companyName });
    assert.equal(result.companyName, null);
  }
});

test('create: title and description are required', () => {
  for (const [body, field] of [
    [{ descriptionText: 'x' }, 'title'],
    [{ ...valid, title: '   ' }, 'title'],
    [{ title: 'x' }, 'descriptionText'],
    [{ ...valid, descriptionText: '' }, 'descriptionText'],
    [{ ...valid, descriptionText: '  \n\t  ' }, 'descriptionText'],
    [{ ...valid, descriptionText: '​﻿­' }, 'descriptionText'],
  ] as const) {
    const result = createJobDescriptionSchema.safeParse(body);
    assert.equal(result.success, false);
    assert.deepEqual(issueFields(result), [field]);
  }
});

test('create: wrong types are rejected', () => {
  for (const body of [
    { ...valid, title: 42 },
    { ...valid, companyName: ['x'] },
    { ...valid, descriptionText: { text: 'x' } },
  ]) {
    assert.equal(createJobDescriptionSchema.safeParse(body).success, false);
  }
});

test('create: limits are enforced without truncating', () => {
  assert.ok(createJobDescriptionSchema.safeParse({ ...valid, title: 'a'.repeat(MAX_TITLE_LENGTH) }).success);
  assert.ok(!createJobDescriptionSchema.safeParse({ ...valid, title: 'a'.repeat(MAX_TITLE_LENGTH + 1) }).success);
  assert.ok(!createJobDescriptionSchema.safeParse({ ...valid, companyName: 'a'.repeat(MAX_COMPANY_NAME_LENGTH + 1) }).success);

  const atLimit = 'a'.repeat(MAX_DESCRIPTION_LENGTH);
  assert.equal(createJobDescriptionSchema.parse({ ...valid, descriptionText: atLimit }).descriptionText, atLimit);
  const tooLong = createJobDescriptionSchema.safeParse({ ...valid, descriptionText: 'a'.repeat(MAX_DESCRIPTION_LENGTH + 1) });
  assert.equal(tooLong.success, false);
});

test('create: user ids and other unknown fields are dropped', () => {
  const result: any = createJobDescriptionSchema.parse({ ...valid, userId: 'someone-else', user_id: 'x', id: 'y' });
  assert.deepEqual(Object.keys(result).sort(), ['companyName', 'descriptionText', 'title']);
});

test('update: validates only supplied fields and allows clearing the company', () => {
  assert.deepEqual(updateJobDescriptionSchema.parse({ title: ' Backend Engineer ' }), { title: 'Backend Engineer' });
  assert.deepEqual(updateJobDescriptionSchema.parse({ companyName: null }), { companyName: null });
  assert.deepEqual(updateJobDescriptionSchema.parse({ companyName: '' }), { companyName: null });
  assert.equal(updateJobDescriptionSchema.safeParse({ title: '' }).success, false);
  assert.equal(updateJobDescriptionSchema.safeParse({ descriptionText: '   ' }).success, false);
});

test('update: an empty change set is rejected', () => {
  assert.equal(updateJobDescriptionSchema.safeParse({}).success, false);
  assert.equal(updateJobDescriptionSchema.safeParse({ userId: 'x' }).success, false);
});
