var screenshot = require('../index');

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
            $('.dropdown .icon-eye-open').click();
            screenshot.snap(this, $('.dropdown.open .dropdown-menu'));
            element(by.cssContainingText('.dropdown.open a', 'FAQ')).click();
        });

        it('should have an odd title', function () {
            screenshot.snap(this);
            expect(browser.getTitle()).to.eventually.contain('FAQ');
        });

    });

});
