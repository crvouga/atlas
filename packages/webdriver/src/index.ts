import type { Locator } from './protocol';

export { webdriverDriver, screen, nativeLocator, type Mode, type Target, type WebDriverContext, type WebDriverDriverOptions, type WebDriverServer } from './driver';
export { WebDriverSession, WebDriverError, waitForServer, ELEMENT_KEY, type Locator, type Rect } from './protocol';
export { css, label, role, testId, text, describeSignal, type Signal } from '@crvouga/atlas/signals';

/** Appium: an accessibility identifier (iOS) or content description (Android); React Native's `testID`. */
export const accessibilityId = (value: string): Locator => ({ using: 'accessibility id', value, name: `accessibility id "${value}"` });
export const xpath = (value: string): Locator => ({ using: 'xpath', value, name: `xpath ${value}` });
/** Appium iOS: an NSPredicate over the element tree, e.g. `label == "Book" AND type == "XCUIElementTypeButton"`. */
export const iosPredicate = (value: string): Locator => ({ using: '-ios predicate string', value, name: `predicate ${value}` });
/** Appium Android: a UiSelector expression, e.g. `new UiSelector().text("Book")`. */
export const androidUiAutomator = (value: string): Locator => ({ using: '-android uiautomator', value, name: `uiautomator ${value}` });
