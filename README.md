# snappit-mocha-protractor

A screenshot tool built on top of [Protractor](http://www.protractortest.org), the end to end testing library for [AngularJS](https://angularjs.org/) applications. **For use with the [Mocha](https://mochajs.org/) test runner**.

Automatically organizes all screenshots to be vcs-friendly, allowing you to track the visual changes of your web site as new code is introduced. Includes scripts to simplify the process of setting up dedicated screenshot repositories, triggering "visual regressions" during pull requests in your project. If your project's code base changes trigger a visual change in your website, you'll be notified about it via a [github mention](https://github.com/blog/957-introducing-issue-mentions) in the project pull request.

All detailed content is located in the Wiki.

1. [Installation and setting up a simple test](https://github.com/rackerlabs/snappit-mocha-protractor/wiki)
0. [Saving screenshots to your project](https://github.com/rackerlabs/snappit-mocha-protractor/wiki/0:-snappit-ci#saving-screenshots-directly-into-your-project)
0. [Saving screenshots into a dedicated screenshots repository](https://github.com/rackerlabs/snappit-mocha-protractor/wiki/0:-snappit-ci#saving-screenshots-into-a-dedicated-screenshots-repository)
0. [Setting up a service account for dedicated screenshots repositories](https://github.com/rackerlabs/snappit-mocha-protractor/wiki/1:-Technical-Overview#a-note-about-using-teams-to-create-screenshot-repositories-with-service-accounts)
0. [Reference Configuration File](https://github.com/rackerlabs/snappit-mocha-protractor/wiki/3:-Reference-Configuration-File)

**Note**: This tool was built against Protractor version > 3.2.2, and is known to not work with 1.X, 2.X, or < 3.2 versions. This is due to a change in the webdriver-js library that supports Protractor. If you are using an older version of Protractor, try using a version from before the 0.1.0 release.

**Note**: If you are migrating to the 0.1.0 release, you will need to delete your screenshots and re-run the tool, as webdriver-js has changed the way that it represents selectors as a string (this affects the resulting filename of the screenshot). Otherwise you'll end up with identical screenshots with different names. It's better to start over than leave them hanging around.
