import * as Blockly from 'blockly';
import { t } from './i18n';
import { BLOCK_TEXT } from './i18n/blocksText';

type FieldSchema = { name: string; label: string; type: 'number' | 'text' | 'color' | 'mouse_btn' | 'keyboard_key' | 'hotkey' | 'select' | 'image_pick' | 'region_pick'; options?: [string, string][]; default: any; tooltip?: string; };

export function legacyCombo(data: any): string {
  return [data?.modifier, data?.key].filter(Boolean).join('+');
}

const clickTypeOptions: [string, string][] = [["field.click.single", "SINGLE"], ["field.click.double", "DOUBLE"]];

const caseSensitiveField: FieldSchema = {
  name: 'case_sensitive', label: 'field.caseSensitiveSel', type: 'select',
  options: [['field.no', 'NO'], ['field.yes', 'YES']], default: 'YES'
};

const searchModeField: FieldSchema = {
  name: 'search_mode', label: 'field.searchMode', type: 'select',
  options: [['field.searchMode.text', 'TEXT'], ['field.searchMode.regex', 'REGEX']],
  default: 'TEXT', tooltip: 'field.searchMode.tip'
};

export const blockSchemas: Record<string, FieldSchema[]> = {
  'action_mouse_move': [{ name: 'duration', label: 'field.durationMs', type: 'number', default: 0 }],
  'action_mouse_move_rel': [{ name: 'duration', label: 'field.durationMs', type: 'number', default: 0 }],
  'action_mouse_move_found': [{ name: 'duration', label: 'field.durationMs', type: 'number', default: 0 }],
  'action_mouse_click': [
    { name: 'button', label: 'field.button', type: 'mouse_btn', default: 'LEFT' },
    { name: 'click_type', label: 'field.clickType', type: 'select', options: clickTypeOptions, default: 'SINGLE' }
  ],
  'action_mouse_down': [{ name: 'button', label: 'field.button', type: 'mouse_btn', default: 'LEFT' }],
  'action_mouse_up': [{ name: 'button', label: 'field.button', type: 'mouse_btn', default: 'LEFT' }],
  'action_mouse_scroll': [{ name: 'amount', label: 'field.scrollAmount', type: 'number', default: 1 }],
  'action_keyboard_type': [
    { name: 'speed', label: 'field.speedMsChar', type: 'number', default: 10 }
  ],
  'action_keyboard_press': [{ name: 'key', label: 'field.key', type: 'keyboard_key', default: 'enter' }],
  'action_keyboard_down': [{ name: 'key', label: 'field.key', type: 'keyboard_key', default: 'enter' }],
  'action_keyboard_up': [{ name: 'key', label: 'field.key', type: 'keyboard_key', default: 'enter' }],
  'action_keyboard_hotkey': [
    { name: 'combo', label: 'field.shortcut', type: 'hotkey', default: 'Ctrl+C', tooltip: 'field.shortcut.tip' }
  ],
  'action_delay': [],
  'logic_image_found': [
    { name: 'image_data', label: 'field.templateImage', type: 'image_pick', default: '' },
    { name: 'tolerance', label: 'field.tolerance150', type: 'number', default: 30 },
    { name: 'min_confidence', label: 'field.minConfidence', type: 'number', default: 80, tooltip: 'field.minConfidence.tip' },
    { name: 'region', label: 'field.searchRegion', type: 'region_pick', default: null, tooltip: 'field.searchRegion.tip' }
  ],
  'logic_color_found': [
    { name: 'hex', label: 'field.colorHex', type: 'color', default: '#FFFFFF' },
    { name: 'tolerance', label: 'field.tolerance150', type: 'number', default: 10 },
    { name: 'region', label: 'field.searchRegion', type: 'region_pick', default: null, tooltip: 'field.searchRegion.tip2' }
  ],
  'logic_pixel_changed': [
    { name: 'tolerance', label: 'field.tolerance150', type: 'number', default: 10, tooltip: 'field.tolerance.pixelChanged.tip' }
  ],
  'logic_region_motion': [
    { name: 'region', label: 'field.watchRegion', type: 'region_pick', default: null },
    { name: 'threshold', label: 'field.motionThreshold', type: 'number', default: 5, tooltip: 'field.motionThreshold.tip' },
    { name: 'tolerance', label: 'field.pixelTolerance150', type: 'number', default: 30 }
  ],
  'sensor_region_change': [
    { name: 'region', label: 'field.watchRegion', type: 'region_pick', default: null },
    { name: 'tolerance', label: 'field.pixelTolerance150', type: 'number', default: 30 }
  ],
  'sensor_screen_text': [
    { name: 'region', label: 'field.visionRegion', type: 'region_pick', default: null, tooltip: 'field.visionRegion.tip' },
    { name: 'lang', label: 'field.langBcp47', type: 'text', default: '', tooltip: 'field.langBcp47.tip' }
  ],
  'logic_text_found': [
    { name: 'search', label: 'field.textToFind', type: 'text', default: '' },
    { name: 'region', label: 'field.visionRegion', type: 'region_pick', default: null, tooltip: 'field.visionRegion.tip' },
    { name: 'lang', label: 'field.langBcp47', type: 'text', default: '', tooltip: 'field.langBcp47.tip' },
    { name: 'match_mode', label: 'field.matchMode', type: 'select', options: [['field.matchMode.contains', 'CONTAINS'], ['field.matchMode.wholeWord', 'WORD'], ['field.matchMode.exactLine', 'EXACT']], default: 'CONTAINS' },
    { name: 'case_sensitive', label: 'field.caseSensitiveSel', type: 'select', options: [['field.no', 'NO'], ['field.yes', 'YES']], default: 'NO' }
  ],
  'logic_random_chance': [{ name: 'chance', label: 'field.probability', type: 'number', default: 50 }],
  'action_run_program': [
    { name: 'wait_ready', label: 'field.waitUntilReady', type: 'select', options: [['field.no', 'NO'], ['field.yes', 'YES']], default: 'NO', tooltip: 'field.waitUntilReady.tip' },
    { name: 'timeout', label: 'field.readyTimeoutMs', type: 'number', default: 15000, tooltip: 'field.waitTimeout.tip' }
  ],
  'action_switch_window': [
    { name: 'match_mode', label: 'field.matchMode', type: 'select', options: [['field.matchMode.contains', 'CONTAINS'], ['field.matchMode.exactLine', 'EXACT']], default: 'CONTAINS' },
    { name: 'case_sensitive', label: 'field.caseSensitiveSel', type: 'select', options: [['field.no', 'NO'], ['field.yes', 'YES']], default: 'NO' },
    { name: 'timeout', label: 'field.windowTimeoutMs', type: 'number', default: 5000, tooltip: 'field.switchWindowTimeout.tip' }
  ],
  'action_log': [],
  'action_wait_for_color': [
    { name: 'hex', label: 'field.targetColor', type: 'color', default: '#FFFFFF' },
    { name: 'interval', label: 'field.scanInterval', type: 'number', default: 100 },
    { name: 'timeout', label: 'field.timeoutMs', type: 'number', default: 0 }
  ],
  'action_wait_for_pixel_change': [
    { name: 'tolerance', label: 'field.tolerance150', type: 'number', default: 10 },
    { name: 'interval', label: 'field.scanInterval', type: 'number', default: 100 },
    { name: 'timeout', label: 'field.timeoutMs', type: 'number', default: 0 }
  ],
  'action_click_found': [
    { name: 'button', label: 'field.button', type: 'mouse_btn', default: 'LEFT' },
    { name: 'click_type', label: 'field.clickType', type: 'select', options: clickTypeOptions, default: 'SINGLE' },
    { name: 'duration', label: 'field.moveDurationMs', type: 'number', default: 0 }
  ],
  'str_contains': [searchModeField, caseSensitiveField],
  'str_replace': [searchModeField, caseSensitiveField],
  'str_regex_match': [{ ...caseSensitiveField, default: 'NO' }]
};

const BASE_CUSTOM_BLOCKS = [
  { "type": "macro_start", "args1": [{ "type": "input_value", "name": "IF", "check": "Boolean" }], "nextStatement": null, "deletable": false, "style": "start_block" },
  { "type": "action_mouse_move", "args0": [{ "type": "input_value", "name": "X", "check": "Number" }, { "type": "input_value", "name": "Y", "check": "Number" }], "inputsInline": true, "previousStatement": null, "nextStatement": null, "style": "mouse_blocks" },
  { "type": "action_mouse_move_rel", "args0": [{ "type": "input_value", "name": "X", "check": "Number" }, { "type": "input_value", "name": "Y", "check": "Number" }], "inputsInline": true, "previousStatement": null, "nextStatement": null, "style": "mouse_blocks" },
  { "type": "action_mouse_move_found", "args0": [{ "type": "input_value", "name": "OFFSET_X", "check": "Number" }, { "type": "input_value", "name": "OFFSET_Y", "check": "Number" }], "inputsInline": true, "previousStatement": null, "nextStatement": null, "style": "mouse_blocks" },
  { "type": "action_delay", "args0": [{ "type": "input_value", "name": "MS", "check": "Number" }], "inputsInline": true, "previousStatement": null, "nextStatement": null, "style": "control_blocks" },
  { "type": "action_wait_for_color", "args0": [{ "type": "input_value", "name": "X", "check": "Number" }, { "type": "input_value", "name": "Y", "check": "Number" }], "inputsInline": true, "previousStatement": null, "nextStatement": null, "style": "control_blocks" },
  { "type": "math_random_custom", "args0": [{ "type": "field_number", "name": "MIN", "value": 0 }, { "type": "field_number", "name": "MAX", "value": 100 }], "output": "Number", "style": "math_blocks" },
  { "type": "action_mouse_click", "previousStatement": null, "nextStatement": null, "style": "mouse_blocks" },
  { "type": "action_mouse_down", "previousStatement": null, "nextStatement": null, "style": "mouse_blocks" },
  { "type": "action_mouse_up", "previousStatement": null, "nextStatement": null, "style": "mouse_blocks" },
  { "type": "action_mouse_scroll", "previousStatement": null, "nextStatement": null, "style": "mouse_blocks" },
  { "type": "action_keyboard_type", "args0": [{ "type": "input_value", "name": "TEXT" }], "inputsInline": true, "previousStatement": null, "nextStatement": null, "style": "keyboard_blocks" },
  { "type": "action_keyboard_press", "previousStatement": null, "nextStatement": null, "style": "keyboard_blocks" },
  { "type": "action_keyboard_down", "previousStatement": null, "nextStatement": null, "style": "keyboard_blocks" },
  { "type": "action_keyboard_up", "previousStatement": null, "nextStatement": null, "style": "keyboard_blocks" },
  { "type": "action_keyboard_hotkey", "previousStatement": null, "nextStatement": null, "style": "keyboard_blocks" },
  { "type": "macro_loop_forever", "args0": [{ "type": "input_dummy" }, { "type": "input_statement", "name": "DO" }], "previousStatement": null, "nextStatement": null, "style": "loop_blocks" },
  { "type": "control_if", "args0": [{ "type": "input_value", "name": "CONDITION", "check": "Boolean" }], "args1": [{ "type": "input_statement", "name": "DO" }], "previousStatement": null, "nextStatement": null, "style": "control_blocks" },
  { "type": "control_wait_until", "args0": [{ "type": "input_value", "name": "CONDITION", "check": "Boolean" }], "previousStatement": null, "nextStatement": null, "style": "control_blocks" },
  { "type": "logic_image_found", "output": "Boolean", "style": "logic_blocks" },
  { "type": "logic_color_found", "output": "Boolean", "style": "logic_blocks" },
  { "type": "logic_text_found", "output": "Boolean", "style": "logic_blocks" },
  { "type": "logic_pixel_changed", "args0": [{ "type": "input_value", "name": "X", "check": "Number" }, { "type": "input_value", "name": "Y", "check": "Number" }], "inputsInline": true, "output": "Boolean", "style": "logic_blocks" },
  { "type": "logic_region_motion", "output": "Boolean", "style": "logic_blocks" },
  { "type": "logic_wait_until_timeout", "args0": [{ "type": "input_value", "name": "CONDITION", "check": "Boolean" }, { "type": "input_value", "name": "TIMEOUT", "check": "Number" }], "inputsInline": true, "output": "Boolean", "style": "logic_blocks" },
  { "type": "logic_random_chance", "output": "Boolean", "style": "logic_blocks" },
  { "type": "action_wait_for_pixel_change", "args0": [{ "type": "input_value", "name": "X", "check": "Number" }, { "type": "input_value", "name": "Y", "check": "Number" }], "inputsInline": true, "previousStatement": null, "nextStatement": null, "style": "control_blocks" },
  { "type": "action_click_found", "args0": [{ "type": "input_value", "name": "OFFSET_X", "check": "Number" }, { "type": "input_value", "name": "OFFSET_Y", "check": "Number" }], "inputsInline": true, "previousStatement": null, "nextStatement": null, "style": "mouse_blocks" },
  { "type": "sensor_mouse_x", "output": "Number", "style": "system_blocks" },
  { "type": "sensor_mouse_y", "output": "Number", "style": "system_blocks" },
  { "type": "sensor_screen_width", "output": "Number", "style": "system_blocks" },
  { "type": "sensor_screen_height", "output": "Number", "style": "system_blocks" },
  { "type": "sensor_found_x", "output": "Number", "style": "system_blocks" },
  { "type": "sensor_found_y", "output": "Number", "style": "system_blocks" },
  { "type": "sensor_match_confidence", "output": "Number", "style": "system_blocks" },
  { "type": "sensor_region_change", "output": "Number", "style": "system_blocks" },
  { "type": "sensor_screen_text", "output": "String", "style": "system_blocks" },
  { "type": "action_run_program", "args0": [{ "type": "input_value", "name": "PATH" }], "inputsInline": true, "previousStatement": null, "nextStatement": null, "style": "system_blocks" },
  { "type": "action_switch_window", "args0": [{ "type": "input_value", "name": "TITLE", "check": "String" }], "inputsInline": true, "previousStatement": null, "nextStatement": null, "style": "system_blocks" },
  { "type": "action_log", "args0": [{ "type": "input_value", "name": "VALUE" }], "inputsInline": true, "previousStatement": null, "nextStatement": null, "style": "system_blocks" },
  { "type": "list_length", "args0": [{ "type": "input_value", "name": "LIST" }], "output": "Number", "style": "data_blocks" },
  { "type": "list_get", "args0": [{ "type": "input_value", "name": "LIST" }, { "type": "input_value", "name": "INDEX", "check": "Number" }], "inputsInline": true, "output": null, "style": "data_blocks" },
  { "type": "list_set", "args0": [{ "type": "input_value", "name": "INDEX", "check": "Number" }, { "type": "field_variable", "name": "VAR" }, { "type": "input_value", "name": "VALUE" }], "inputsInline": true, "previousStatement": null, "nextStatement": null, "style": "data_blocks" },
  { "type": "list_remove", "args0": [{ "type": "input_value", "name": "INDEX", "check": "Number" }, { "type": "field_variable", "name": "VAR" }], "inputsInline": true, "previousStatement": null, "nextStatement": null, "style": "data_blocks" },
  { "type": "list_append", "args0": [{ "type": "input_value", "name": "ITEM" }, { "type": "field_variable", "name": "VAR" }], "inputsInline": true, "previousStatement": null, "nextStatement": null, "style": "data_blocks" },
  { "type": "list_clear", "args0": [{ "type": "field_variable", "name": "VAR" }], "previousStatement": null, "nextStatement": null, "style": "data_blocks" },
  { "type": "list_contains", "args0": [{ "type": "input_value", "name": "LIST" }, { "type": "input_value", "name": "ITEM" }], "inputsInline": true, "output": "Boolean", "style": "data_blocks" },
  { "type": "list_index_of", "args0": [{ "type": "input_value", "name": "ITEM" }, { "type": "input_value", "name": "LIST" }], "inputsInline": true, "output": "Number", "style": "data_blocks" },
  { "type": "list_join", "args0": [{ "type": "input_value", "name": "LIST" }, { "type": "input_value", "name": "SEP", "check": "String" }], "inputsInline": true, "output": "String", "style": "data_blocks" },
  { "type": "object_get", "args0": [{ "type": "input_value", "name": "OBJ" }, { "type": "input_value", "name": "KEY", "check": "String" }], "inputsInline": true, "output": null, "style": "data_blocks" },
  { "type": "object_set", "args0": [{ "type": "input_value", "name": "KEY", "check": "String" }, { "type": "field_variable", "name": "VAR" }, { "type": "input_value", "name": "VALUE" }], "inputsInline": true, "previousStatement": null, "nextStatement": null, "style": "data_blocks" },
  { "type": "object_delete", "args0": [{ "type": "input_value", "name": "KEY", "check": "String" }, { "type": "field_variable", "name": "VAR" }], "inputsInline": true, "previousStatement": null, "nextStatement": null, "style": "data_blocks" },
  { "type": "object_keys", "args0": [{ "type": "input_value", "name": "OBJ" }], "output": null, "style": "data_blocks" },
  { "type": "object_has", "args0": [{ "type": "input_value", "name": "OBJ" }, { "type": "input_value", "name": "KEY", "check": "String" }], "inputsInline": true, "output": "Boolean", "style": "data_blocks" },
  { "type": "object_size", "args0": [{ "type": "input_value", "name": "OBJ" }], "output": "Number", "style": "data_blocks" },
  { "type": "str_join", "args0": [{ "type": "input_value", "name": "A" }, { "type": "input_value", "name": "B" }], "inputsInline": true, "output": "String", "style": "text_blocks" },
  { "type": "str_length", "args0": [{ "type": "input_value", "name": "TEXT" }], "output": "Number", "style": "text_blocks" },
  { "type": "str_contains", "args0": [{ "type": "input_value", "name": "TEXT" }, { "type": "input_value", "name": "SEARCH" }], "inputsInline": true, "output": "Boolean", "style": "text_blocks" },
  { "type": "str_substring", "args0": [{ "type": "input_value", "name": "TEXT" }, { "type": "input_value", "name": "FROM", "check": "Number" }, { "type": "input_value", "name": "TO", "check": "Number" }], "inputsInline": true, "output": "String", "style": "text_blocks" },
  { "type": "str_index_of", "args0": [{ "type": "input_value", "name": "SEARCH" }, { "type": "input_value", "name": "TEXT" }], "inputsInline": true, "output": "Number", "style": "text_blocks" },
  { "type": "str_replace", "args0": [{ "type": "input_value", "name": "FIND" }, { "type": "input_value", "name": "REPLACE" }, { "type": "input_value", "name": "TEXT" }], "inputsInline": true, "output": "String", "style": "text_blocks" },
  { "type": "str_case", "args0": [{ "type": "input_value", "name": "TEXT" }, { "type": "field_dropdown", "name": "CASE", "options": [["field.case.upper", "UPPER"], ["field.case.lower", "LOWER"], ["field.case.trim", "TRIM"]] }], "inputsInline": true, "output": "String", "style": "text_blocks" },
  { "type": "str_regex_match", "args0": [{ "type": "input_value", "name": "PATTERN", "check": "String" }, { "type": "input_value", "name": "TEXT" }, { "type": "input_value", "name": "GROUP", "check": "Number" }], "inputsInline": true, "output": "String", "style": "text_blocks" },
  { "type": "str_split", "args0": [{ "type": "input_value", "name": "TEXT" }, { "type": "input_value", "name": "SEP", "check": "String" }], "inputsInline": true, "output": null, "style": "text_blocks" },
  { "type": "str_to_number", "args0": [{ "type": "input_value", "name": "TEXT" }], "output": "Number", "style": "text_blocks" },
  { "type": "str_from_value", "args0": [{ "type": "input_value", "name": "VALUE" }], "output": "String", "style": "text_blocks" }
];

function buildCustomBlocks(): any[] {
  return BASE_CUSTOM_BLOCKS.map(block => {
    const text = BLOCK_TEXT[block.type];
    const out: any = { ...block };
    out.message0 = text?.message0 ? t(text.message0) : block.type;
    if (text?.message1) out.message1 = t(text.message1);
    if (text?.tooltip) out.tooltip = t(text.tooltip);
    if ('args0' in block && block.args0 && Array.isArray((block as any).args0)) {
      out.args0 = (block as any).args0.map((arg: any) => {
        if (arg.type === 'field_dropdown' && Array.isArray(arg.options)) {
          return { ...arg, options: arg.options.map(([key, val]: [string, string]) => [t(key), val]) };
        }
        return arg;
      });
    }
    return out;
  });
}

export function initBlocks() {
  try {
    Blockly.Extensions.registerMutator('asmacro_custom_mutator', {
      saveExtraState: function() {
        return null;
      },
      loadExtraState: function(this: Blockly.Block, state: any) {
        if (state && state.customMacroData !== undefined) {
          this.data = state.customMacroData;
        }
      },
      mutationToDom: function(this: Blockly.Block) {
        const container = document.createElement('mutation');
        if (this.data) container.setAttribute('custom_data', this.data);
        return container;
      },
      domToMutation: function(this: Blockly.Block, xmlElement: Element) {
        const data = xmlElement.getAttribute('custom_data');
        if (data) this.data = data;
      }
    });
  } catch (e) {}

  const blocksWithMutator = buildCustomBlocks().map(block => ({
    ...block,
    mutator: 'asmacro_custom_mutator'
  }));

  Blockly.defineBlocksWithJsonArray(blocksWithMutator);
}

export function buildToolbox() {
  return {
    kind: 'categoryToolbox',
    contents: [
      { kind: 'category', name: t('toolbox.variables'), custom: 'VARIABLE', colour: '#e91e8c' },
      { kind: 'category', name: t('toolbox.logic'), colour: '#c9a227', contents: [
        { kind: 'block', type: 'logic_compare' },
        { kind: 'block', type: 'logic_operation' },
        { kind: 'block', type: 'logic_negate' },
        { kind: 'block', type: 'logic_boolean' },
        { kind: 'block', type: 'logic_random_chance' },
        { kind: 'block', type: 'logic_wait_until_timeout', inputs: { TIMEOUT: { shadow: { type: 'math_number', fields: { NUM: 5000 } } } } }
      ]},
      { kind: 'category', name: t('toolbox.vision'), colour: '#00b8d4', contents: [
        { kind: 'block', type: 'logic_image_found' },
        { kind: 'block', type: 'logic_color_found' },
        { kind: 'block', type: 'logic_text_found' },
        { kind: 'block', type: 'sensor_screen_text' },
        { kind: 'block', type: 'logic_pixel_changed', inputs: { X: { shadow: { type: 'math_number', fields: { NUM: 0 } } }, Y: { shadow: { type: 'math_number', fields: { NUM: 0 } } } } },
        { kind: 'block', type: 'logic_region_motion' },
        { kind: 'block', type: 'sensor_region_change' },
        { kind: 'block', type: 'sensor_found_x' },
        { kind: 'block', type: 'sensor_found_y' },
        { kind: 'block', type: 'sensor_match_confidence' }
      ]},
      { kind: 'category', name: t('toolbox.math'), colour: '#16a085', contents: [
        { kind: 'block', type: 'math_number' },
        { kind: 'block', type: 'math_arithmetic' },
        { kind: 'block', type: 'math_random_custom' }
      ]},
      { kind: 'category', name: t('toolbox.text'), colour: '#4a90d9', contents: [
        { kind: 'block', type: 'str_join', inputs: { A: { shadow: { type: 'text', fields: { TEXT: '' } } }, B: { shadow: { type: 'text', fields: { TEXT: '' } } } } },
        { kind: 'block', type: 'str_length', inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: '' } } } } },
        { kind: 'block', type: 'str_contains', inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: '' } } }, SEARCH: { shadow: { type: 'text', fields: { TEXT: '' } } } } },
        { kind: 'block', type: 'str_substring', inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: '' } } }, FROM: { shadow: { type: 'math_number', fields: { NUM: 1 } } }, TO: { shadow: { type: 'math_number', fields: { NUM: 1 } } } } },
        { kind: 'block', type: 'str_index_of', inputs: { SEARCH: { shadow: { type: 'text', fields: { TEXT: '' } } }, TEXT: { shadow: { type: 'text', fields: { TEXT: '' } } } } },
        { kind: 'block', type: 'str_replace', inputs: { FIND: { shadow: { type: 'text', fields: { TEXT: '' } } }, REPLACE: { shadow: { type: 'text', fields: { TEXT: '' } } }, TEXT: { shadow: { type: 'text', fields: { TEXT: '' } } } } },
        { kind: 'block', type: 'str_case', inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: '' } } } } },
        { kind: 'block', type: 'str_regex_match', inputs: {
          PATTERN: { shadow: { type: 'text', fields: { TEXT: '' } } },
          TEXT: { shadow: { type: 'text', fields: { TEXT: '' } } },
          GROUP: { shadow: { type: 'math_number', fields: { NUM: 0 } } }
        } },
        { kind: 'block', type: 'str_split', inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: '' } } }, SEP: { shadow: { type: 'text', fields: { TEXT: ',' } } } } },
        { kind: 'block', type: 'str_to_number', inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: '0' } } } } },
        { kind: 'block', type: 'str_from_value' }
      ]},
      { kind: 'category', name: t('toolbox.data'), colour: '#9b59b6', contents: [
        { kind: 'block', type: 'list_length' },
        { kind: 'block', type: 'list_get', inputs: { INDEX: { shadow: { type: 'math_number', fields: { NUM: 1 } } } } },
        { kind: 'block', type: 'list_set', inputs: { INDEX: { shadow: { type: 'math_number', fields: { NUM: 1 } } } } },
        { kind: 'block', type: 'list_remove', inputs: { INDEX: { shadow: { type: 'math_number', fields: { NUM: 1 } } } } },
        { kind: 'block', type: 'list_append' },
        { kind: 'block', type: 'list_clear' },
        { kind: 'block', type: 'list_contains' },
        { kind: 'block', type: 'list_index_of' },
        { kind: 'block', type: 'list_join', inputs: { SEP: { shadow: { type: 'text', fields: { TEXT: ',' } } } } },
        { kind: 'block', type: 'object_get', inputs: { KEY: { shadow: { type: 'text', fields: { TEXT: 'key' } } } } },
        { kind: 'block', type: 'object_set', inputs: { KEY: { shadow: { type: 'text', fields: { TEXT: 'key' } } } } },
        { kind: 'block', type: 'object_delete', inputs: { KEY: { shadow: { type: 'text', fields: { TEXT: 'key' } } } } },
        { kind: 'block', type: 'object_keys' },
        { kind: 'block', type: 'object_has', inputs: { KEY: { shadow: { type: 'text', fields: { TEXT: 'key' } } } } },
        { kind: 'block', type: 'object_size' }
      ]},
      { kind: 'category', name: t('toolbox.loops'), colour: '#8e44ad', contents: [
        { kind: 'block', type: 'macro_loop_forever' },
        { kind: 'block', type: 'controls_repeat_ext', inputs: { TIMES: { shadow: { type: 'math_number', fields: { NUM: 10 } } } } },
        { kind: 'block', type: 'controls_whileUntil' },
        { kind: 'block', type: 'controls_forEach' },
        { kind: 'block', type: 'controls_flow_statements' }
      ]},
      { kind: 'category', name: t('toolbox.mouse'), colour: '#2f80ed', contents: [
        { kind: 'block', type: 'action_mouse_move', inputs: { X: { shadow: { type: 'math_number', fields: { NUM: 0 } } }, Y: { shadow: { type: 'math_number', fields: { NUM: 0 } } } }},
        { kind: 'block', type: 'action_mouse_move_rel', inputs: { X: { shadow: { type: 'math_number', fields: { NUM: 0 } } }, Y: { shadow: { type: 'math_number', fields: { NUM: 0 } } } }},
        { kind: 'block', type: 'action_mouse_move_found', inputs: { OFFSET_X: { shadow: { type: 'math_number', fields: { NUM: 0 } } }, OFFSET_Y: { shadow: { type: 'math_number', fields: { NUM: 0 } } } }},
        { kind: 'block', type: 'action_click_found', inputs: { OFFSET_X: { shadow: { type: 'math_number', fields: { NUM: 0 } } }, OFFSET_Y: { shadow: { type: 'math_number', fields: { NUM: 0 } } } }},
        { kind: 'block', type: 'action_mouse_click' },
        { kind: 'block', type: 'action_mouse_down' },
        { kind: 'block', type: 'action_mouse_up' },
        { kind: 'block', type: 'action_mouse_scroll' }
      ]},
      { kind: 'category', name: t('toolbox.keyboard'), colour: '#27ae60', contents: [
        { kind: 'block', type: 'action_keyboard_type', inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: '' } } } } },
        { kind: 'block', type: 'action_keyboard_press' },
        { kind: 'block', type: 'action_keyboard_down' },
        { kind: 'block', type: 'action_keyboard_up' },
        { kind: 'block', type: 'action_keyboard_hotkey' }
      ]},
      { kind: 'category', name: t('toolbox.control'), colour: '#e74c3c', contents: [
        { kind: 'block', type: 'action_delay', inputs: { MS: { shadow: { type: 'math_number', fields: { NUM: 1000 } } } }},
        { kind: 'block', type: 'action_wait_for_color', inputs: { X: { shadow: { type: 'math_number', fields: { NUM: 0 } } }, Y: { shadow: { type: 'math_number', fields: { NUM: 0 } } } }},
        { kind: 'block', type: 'action_wait_for_pixel_change', inputs: { X: { shadow: { type: 'math_number', fields: { NUM: 0 } } }, Y: { shadow: { type: 'math_number', fields: { NUM: 0 } } } }},
        { kind: 'block', type: 'control_wait_until' },
        { kind: 'block', type: 'control_if' }
      ]},
      { kind: 'category', name: t('toolbox.system'), colour: '#e67e22', contents: [
        { kind: 'block', type: 'sensor_mouse_x' },
        { kind: 'block', type: 'sensor_mouse_y' },
        { kind: 'block', type: 'sensor_screen_width' },
        { kind: 'block', type: 'sensor_screen_height' },
        { kind: 'block', type: 'action_run_program', inputs: { PATH: { shadow: { type: 'text', fields: { TEXT: '' } } } } },
        { kind: 'block', type: 'action_switch_window', inputs: { TITLE: { shadow: { type: 'text', fields: { TEXT: '' } } } } },
        { kind: 'block', type: 'action_log' }
      ]}
    ],
  };
}

const asmacroBlockStyles = {
  mouse_blocks: { colourPrimary: '#2f80ed', colourSecondary: '#2567bd', colourTertiary: '#1b4d8e' },
  keyboard_blocks: { colourPrimary: '#27ae60', colourSecondary: '#1f8b4d', colourTertiary: '#15633a' },
  logic_blocks: { colourPrimary: '#c9a227', colourSecondary: '#a5851f', colourTertiary: '#7d6417' },
  loop_blocks: { colourPrimary: '#8e44ad', colourSecondary: '#743a8f', colourTertiary: '#582c6d' },
  control_blocks: { colourPrimary: '#e74c3c', colourSecondary: '#c0392b', colourTertiary: '#932c22' },
  system_blocks: { colourPrimary: '#e67e22', colourSecondary: '#c96b1c', colourTertiary: '#9c5316' },
  math_blocks: { colourPrimary: '#16a085', colourSecondary: '#12836c', colourTertiary: '#0d6252' },
  start_block: { colourPrimary: '#5a5a5a', colourSecondary: '#484848', colourTertiary: '#333333', hat: 'cap' },
  data_blocks: { colourPrimary: '#9b59b6', colourSecondary: '#824aa0', colourTertiary: '#633879' },
  text_blocks: { colourPrimary: '#4a90d9', colourSecondary: '#3d78b8', colourTertiary: '#2f5c8f' },
};

export const asmacroTheme = Blockly.Theme.defineTheme('asmacroTheme', {
  name: 'asmacroTheme',
  base: Blockly.Themes.Zelos,
  fontStyle: { family: 'Inter, -apple-system, sans-serif', weight: '600', size: 11 },
  componentStyles: {
    workspaceBackgroundColour: '#121212',
    toolboxBackgroundColour: '#181818',
    toolboxForegroundColour: '#e0e0e0',
    flyoutBackgroundColour: '#1e1e1e',
    flyoutForegroundColour: '#e0e0e0',
    scrollbarColour: '#3e3e42',
    insertionMarkerColour: '#007acc',
    insertionMarkerOpacity: 0.5,
    selectedGlowColour: '#007acc',
    cursorColour: '#007acc',
  },
  blockStyles: asmacroBlockStyles,
});

export const asmacroThemeLight = Blockly.Theme.defineTheme('asmacroThemeLight', {
  name: 'asmacroThemeLight',
  base: Blockly.Themes.Zelos,
  fontStyle: { family: 'Inter, -apple-system, sans-serif', weight: '600', size: 11 },
  componentStyles: {
    workspaceBackgroundColour: '#f5f5f5',
    toolboxBackgroundColour: '#eeeeee',
    toolboxForegroundColour: '#1a1a1a',
    flyoutBackgroundColour: '#ffffff',
    flyoutForegroundColour: '#1a1a1a',
    scrollbarColour: '#c4c4c4',
    insertionMarkerColour: '#007acc',
    insertionMarkerOpacity: 0.5,
    selectedGlowColour: '#007acc',
    cursorColour: '#007acc',
  },
  blockStyles: asmacroBlockStyles,
});

export const VAR_WRITER_TYPES = new Set(['variables_set', 'math_change', 'list_append', 'list_clear', 'list_set', 'list_remove', 'object_set', 'object_delete', 'controls_forEach']);
