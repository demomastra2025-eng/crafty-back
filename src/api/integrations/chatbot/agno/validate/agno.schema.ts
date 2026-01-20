import { JSONSchema7 } from 'json-schema';
import { v4 } from 'uuid';

const isNotEmpty = (...propertyNames: string[]): JSONSchema7 => {
  const properties = {};
  propertyNames.forEach(
    (property) =>
      (properties[property] = {
        minLength: 1,
        description: `The "${property}" cannot be empty`,
      }),
  );
  return {
    if: {
      propertyNames: {
        enum: [...propertyNames],
      },
    },
    then: { properties },
  };
};

export const agnoSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    enabled: { type: 'boolean' },
    description: { type: 'string' },
    prompt: { type: 'string' },
    agentId: { type: 'string' },
    agentConfig: { type: ['object', 'null'] },
    webhookUrl: { type: ['string', 'null'] },
    providerModel: { type: ['string', 'null'] },
    agnoPort: { type: ['integer', 'null'] },
    funnelId: { type: ['string', 'null'] },
    triggerType: { type: 'string', enum: ['all', 'keyword', 'none', 'advanced'] },
    triggerOperator: { type: 'string', enum: ['equals', 'contains', 'startsWith', 'endsWith', 'regex'] },
    triggerValue: { type: 'string' },
    expire: { type: 'integer' },
    keywordFinish: { type: 'string' },
    delayMessage: { type: 'integer' },
    unknownMessage: { type: 'string' },
    listeningFromMe: { type: 'boolean' },
    stopBotFromMe: { type: 'boolean' },
    keepOpen: { type: 'boolean' },
    debounceTime: { type: 'integer' },
    ignoreJids: { type: 'array', items: { type: 'string' } },
    splitMessages: { type: 'boolean' },
    timePerChar: { type: 'integer' },
  },
  required: ['enabled', 'triggerType'],
  ...isNotEmpty('enabled', 'triggerType'),
};

export const agnoStatusSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    remoteJid: { type: 'string' },
    status: { type: 'string', enum: ['opened', 'closed', 'paused', 'delete'] },
    allSessions: { type: 'boolean' },
    botId: { type: 'string' },
  },
  required: ['status'],
  anyOf: [{ required: ['remoteJid'] }, { required: ['botId'], properties: { allSessions: { const: true } } }],
  ...isNotEmpty('remoteJid', 'status', 'botId'),
};

export const agnoSettingSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    expire: { type: 'integer' },
    keywordFinish: { type: 'string' },
    delayMessage: { type: 'integer' },
    unknownMessage: { type: 'string' },
    listeningFromMe: { type: 'boolean' },
    stopBotFromMe: { type: 'boolean' },
    keepOpen: { type: 'boolean' },
    debounceTime: { type: 'integer' },
    ignoreJids: { type: 'array', items: { type: 'string' } },
    agnoIdFallback: { type: 'string' },
    splitMessages: { type: 'boolean' },
    timePerChar: { type: 'integer' },
  },
  required: [
    'expire',
    'keywordFinish',
    'delayMessage',
    'unknownMessage',
    'listeningFromMe',
    'stopBotFromMe',
    'keepOpen',
    'debounceTime',
    'ignoreJids',
  ],
  ...isNotEmpty(
    'expire',
    'keywordFinish',
    'delayMessage',
    'unknownMessage',
    'listeningFromMe',
    'stopBotFromMe',
    'keepOpen',
    'debounceTime',
    'ignoreJids',
  ),
};

export const agnoIgnoreJidSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    remoteJid: { type: 'string' },
    action: { type: 'string', enum: ['add', 'remove'] },
  },
  required: ['remoteJid', 'action'],
  ...isNotEmpty('remoteJid', 'action'),
};

export const agnoEmitSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    remoteJid: { type: 'string' },
  },
  required: ['remoteJid'],
  ...isNotEmpty('remoteJid'),
};
