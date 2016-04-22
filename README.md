**Note**: This tool was built against Protractor version > 3.2.2, and is known to not work with 1.X, 2.X, or < 3.2 versions. This is due to a change in the webdriver-js library that supports Protractor. If you are using an older version of Protractor, try using a version from before the 0.1.0 release.

**Note**: If you are migrating to the 0.1.0 release, you will need to delete your screenshots and re-run the tool, as webdriver-js has changed the way that it represents selectors as a string (this affects the resulting filename of the screenshot). Otherwise you'll end up with identical screenshots with different names. It's better to start over than leave them hanging around.

# snappit-mocha-protractor

Many tools feature screenshot support, but default to full-page screenshots. This kills any sort of confidence in running visual regression tests, as the entire page can be filled with content that you don't care about. Much of that content often changes, as well. Why deal with all the noise of false positives when you could be taking screenshots of just the things you care about?

Sure, there are libraries that support this. But they'll require that you build *yet another* suite of tests in a DSL that must spin up in it's own context, potentially doubling your test runs. Also, how can you interact with your screen and capture the visual content while doing things your customers will do?

This tool uses Selenium, which you probably already have tests for, and integrating it into your existing Protractor test suite is pretty straight forward.

# Install

    npm install --save-dev snappit-mocha-protractor

*protractor.conf.js*

```js
onPrepare: function () {
    screenshot = require('snappit-mocha-protractor');
}
```

*.jshintrc*

    "globals": {
        "screenshot": true
    }

*spec.js*

```js
describe('Angular JS', function () {
    before(function () {
        browser.get('https://angularjs.org');
    });

    it('should be on the right page', function () {
        screenshot.snap(this, $('.center.stage-buttons'), {
            resolutions: [[1366, 768], [320, 568]]
        });
        expect(browser.getTitle()).to.eventually.contain('AngularJS');
    });

    it('should have a navigation section at the top', function () {
        var navbar = $('.navbar-inner .container');
        screenshot.snap(this, navbar, {
            resolutions: [[320, 568], [568, 320]],
            ignoreDefaultResolutions: true
        });
        expect(navbar.isPresent()).to.eventually.be.true;
    });

    describe('Tutorial', function () {

        before(function () {
            $('.dropdown .icon-book').click();
            screenshot.snap(this, $('.dropdown.open .dropdown-menu'));
            element(by.cssContainingText('.dropdown.open a', 'Tutorial')).click();
        });

        it('should have an odd title', function () {
            screenshot.snap(this);
            expect(browser.getTitle()).to.eventually.contain('Tutorial: Tutorial');
        });

    });

    describe('disabling screenshots', function () {

        before(function () {
            screenshot.disable = true;
        });

        it('should not take a screenshot of the header', function () {
            var header = $('#phonecat-tutorial-app');
            screenshot.snap(this, header);
            expect(header.getText()).to.eventually.contain('PhoneCat');
        });

        after(function () {
            screenshot.disable = false;
        });

    });

});
```

## Testing Responsive Elements

The first call to `screenshot.snap` in the example above contains a list of width/height information. This will resize the screen, then take a screenshot of that element for each resolution passed in.

```js
screenshot.snap(this, $('.center.stage-buttons'), { resolutions: [[768, 1024], [320, 568]] });
```

**Note**: Chrome can only support widths as low as 400px. Firefox can only go as low as 335px.

If you find yourself needing to take a picture at several resolutions many times, then look into configuring `screenshot` to automatically take those at every call to `screenshot.snap`.

```js
onPrepare: function () {
    screenshot = require('snappit-mocha-protractor');
    screenshot.configure({
        defaultResolutions: [[768, 1024], [1024, 768], // tablet
                             [320, 568], [568, 320]]  // phone
    });
}
```

Once you've got that set up, you can always ignore the default resolution by passing in `{ ignoreDefaultResolutions: true }` into a single call to `screenshot.snap`.

**Note**: Using too many default resolutions can *significantly* increase test run times. If you are absolutely sure you need that many screenshots, use Chrome. [It's much faster.](#a-word-about-full-size-screenshots)

## Configuring the threshold

The threshold for when an image should be saved in place of an old image (triggering a change in `git`), can be accessed in `screenshot.threshold`. It accepts an integer representing the percentage (between 0 and 100).

```js
onPrepare: function () {
    screenshot = require('snappit-mocha-protractor');
    screenshot.configure({
        threshold: 2
    });
}
```

## Unrendered areas of the screen

If your element isn't visible when `screenshot.snap` is called, depending on your browser, you'll see different results.

Firefox's unrendered areas are unpainted, but drawn with an interesting monochromatic scheme.

Chrome's unrendered areas are completely blacked out.

## A word about full size screenshots

Chrome screenshots that take up the entire screen are not like Firefox's. Firefox will capture the entire screen, even parts of it that are not currently viewable. Chrome will not!

Because of this, and possibly other reasons, taking screenshots with Chrome is *significantly* faster than Firefox. This test suite runs in about 50 seconds in Firefox, and 11 seconds in Chrome!

## Promoting code reuse

If you don't want any screenshots taken for a certain test suite, you can disable them in the `before` section of that `describe` block. Or, you can have your faster, more frequent tests disable the screenshot routine entirely.

*protractor.noScreenshot.conf.js*

```js
onPrepare: function () {
    screenshot = require('snappit-mocha-protractor');
    screenshot.disable = true;
}
```

That way, you can have a separate conf file that runs during pull request builds, and another one that does visual regression running at night.
