import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { parseDocument } from 'yaml';
import { z } from 'zod';

const identifier = z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/)
  .refine(v => !['constructor', 'prototype'].includes(v), 'Reserved identifier');
const text = z.string().refine(v => v.trim().length > 0, 'Must not be blank');
const unique = (values: string[]) => new Set(values).size === values.length;
const questionSchema = z.object({ text, models: z.record(identifier, z.boolean().nullable()) }).strict();
const configSchema = z.object({
  version: z.literal(1),
  models: z.array(identifier).min(1).refine(unique, 'Duplicate model'),
  questions: z.record(identifier, questionSchema).refine(v => Object.keys(v).length > 0, 'No questions'),
}).strict();
const taskSchema = z.object({
  id: identifier,
  instructions: text.optional(),
  instructions_file: text.optional(),
  expected_models: z.array(identifier).min(1).refine(unique, 'Duplicate expected model'),
}).strict().refine(v => (v.instructions !== undefined) !== (v.instructions_file !== undefined),
  'Supply exactly one of instructions or instructions_file');
const benchSchema = z.object({
  version: z.literal(1).default(1),
  tasks: z.array(taskSchema).min(1).refine(v => unique(v.map(t => t.id)), 'Duplicate task ID'),
}).strict();

export type QuestionConfig = z.infer<typeof configSchema>;
export type Question = QuestionConfig['questions'][string];
export type Task = { id: string; instructions: string; expected_models: string[] };
export type Inputs = { config: QuestionConfig; tasks: Task[] };

export function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function parseYaml(source: string, name: string): unknown {
  const doc = parseDocument(source, { version: '1.2', uniqueKeys: true, stringKeys: true });
  if (doc.errors.length || doc.warnings.length) {
    throw new Error(`${name}: ${[...doc.errors, ...doc.warnings].map(e => e.message).join('; ')}`);
  }
  // Alias expansion is unnecessary for the small, editable experiment format.
  return doc.toJS({ maxAliasCount: 0 });
}

export function parseQuestions(value: unknown): QuestionConfig {
  const config = configSchema.parse(value);
  for (const [id, question] of Object.entries(config.questions)) {
    const keys = Object.keys(question.models);
    if (keys.length !== config.models.length || keys.some(k => !config.models.includes(k))) {
      throw new Error(`Question ${id}: models must contain exactly ${config.models.join(', ')}; use null for unknown`);
    }
  }
  return config;
}

export async function loadInputs(questionsFile: string, benchFile: string): Promise<Inputs> {
  const config = parseQuestions(parseYaml(await readFile(questionsFile, 'utf8'), questionsFile));
  const bench = benchSchema.parse(parseYaml(await readFile(benchFile, 'utf8'), benchFile));
  const tasks: Task[] = [];
  for (const task of bench.tasks) {
    if (task.expected_models.some(m => !config.models.includes(m))) {
      throw new Error(`Task ${task.id}: expected_models contains an undeclared model`);
    }
    const instructions = task.instructions ?? await readFile(resolve(dirname(benchFile), task.instructions_file!), 'utf8');
    text.parse(instructions);
    tasks.push({ id: task.id, instructions, expected_models: task.expected_models });
  }
  return { config, tasks };
}
