import { LightningElement, api } from "lwc";

let nextId = 0;

/**
 * A searchable, filterable single-select combobox following the SLDS searchable-listbox
 * pattern, with up/down/enter keyboard navigation. Used in place of lightning-combobox
 * wherever the option list can run into the hundreds (object and field API names), since
 * lightning-combobox has no built-in typeahead.
 */
export default class SchemaOptionPicker extends LightningElement {
  @api label;
  @api placeholder = "Search...";
  @api required = false;
  @api disabled = false;

  uniqueId = `schema-option-picker-${nextId++}`;

  searchTerm = "";
  isOpen = false;
  activeIndex = -1;
  displayLabel = "";

  _options = [];
  @api
  get options() {
    return this._options;
  }
  set options(value) {
    this._options = Array.isArray(value) ? value : [];
    this.syncDisplayLabel();
  }

  _value;
  @api
  get value() {
    return this._value;
  }
  set value(val) {
    this._value = val;
    this.syncDisplayLabel();
  }

  get inputId() {
    return `${this.uniqueId}-input`;
  }

  get listboxId() {
    return `${this.uniqueId}-listbox`;
  }

  get requiredMarker() {
    return this.required ? " *" : "";
  }

  get inputValue() {
    return this.isOpen ? this.searchTerm : this.displayLabel;
  }

  get comboboxClass() {
    return this.isOpen
      ? "slds-combobox slds-dropdown-trigger slds-dropdown-trigger_click slds-is-open"
      : "slds-combobox slds-dropdown-trigger slds-dropdown-trigger_click";
  }

  get filteredOptions() {
    const term = (this.searchTerm || "").toLowerCase();
    const source = term
      ? this._options.filter((opt) => (opt.label || "").toLowerCase().includes(term))
      : this._options;
    return source.map((opt, index) => ({
      ...opt,
      computedClass:
        index === this.activeIndex
          ? "slds-listbox__option slds-listbox__option_plain slds-media slds-media_small slds-has-focus"
          : "slds-listbox__option slds-listbox__option_plain slds-media slds-media_small"
    }));
  }

  get showNoResults() {
    return this.isOpen && this.filteredOptions.length === 0;
  }

  syncDisplayLabel() {
    // Nothing selected yet must always mean "show the placeholder" — never fall back to any
    // entry in the options list (e.g. its first/sorted-first row) just because a value hasn't
    // been chosen.
    if (!this._value) {
      this.displayLabel = "";
    } else {
      const match = this._options.find((opt) => opt.value === this._value);
      this.displayLabel = match ? match.label || "" : "";
    }
    if (!this.isOpen) {
      this.searchTerm = this.displayLabel;
    }
  }

  handleFocus() {
    this.isOpen = true;
    this.searchTerm = "";
    this.activeIndex = -1;
  }

  handleInput(event) {
    this.searchTerm = event.target.value;
    this.isOpen = true;
    this.activeIndex = -1;
  }

  handleBlur() {
    // Let a mousedown on an option register before the dropdown closes.
    window.setTimeout(() => {
      this.isOpen = false;
      this.syncDisplayLabel();
    }, 150);
  }

  handleKeyDown(event) {
    const options = this.filteredOptions;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.isOpen = true;
      this.activeIndex = Math.min(this.activeIndex + 1, options.length - 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      this.activeIndex = Math.max(this.activeIndex - 1, 0);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (this.activeIndex >= 0 && options[this.activeIndex]) {
        this.selectOption(options[this.activeIndex]);
      }
    } else if (event.key === "Escape") {
      this.isOpen = false;
      this.syncDisplayLabel();
    }
  }

  handleOptionMouseDown(event) {
    const value = event.currentTarget.dataset.value;
    const option = this._options.find((opt) => opt.value === value);
    if (option) {
      this.selectOption(option);
    }
  }

  selectOption(option) {
    this._value = option.value;
    this.displayLabel = option.label;
    this.searchTerm = option.label;
    this.isOpen = false;
    this.dispatchEvent(
      new CustomEvent("change", { detail: { value: option.value, label: option.label } })
    );
  }
}
