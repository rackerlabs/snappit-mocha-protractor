# snappit-mocha-protractor

Many tools feature screenshot support, but default to full-page screenshots. This kills any sort of confidence in running visual regression tests, as the entire page can be filled with content that you don't care about. Much of that content often changes, as well. Why deal with all the noise of false postiives when you could be taking screenshots of just the things you care about?

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
        screenshot.snap(this, $('.navbar-inner .container'));
        expect(browser.getTitle()).to.eventually.contain('AngularJS');
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

});
```
