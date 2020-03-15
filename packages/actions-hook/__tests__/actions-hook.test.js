// @ts-check
const {expect} = require('chai');
const sinon = require('sinon');
const got = require('got');

const _module = require('..');
const sendPayload = _module.default;

/**
 * @returns {void}
 */
const noop = () => null;

const TESTING_PAYLOAD_HASH = 'sha256=79ee8ebb044e31f5ec95e87202d1c61cad14703847a5edafe82f36018760f915';

describe('actions-hook', () => {
	/** @type sinon.SinonStub */
	let gotStub;

	beforeEach(function () {
		// @ts-ignore
		gotStub = sinon.stub(got, 'post');
	});

	afterEach(function () {
		sinon.restore();
	});

	it('properly stringifies payload', async function () {
		await sendPayload({url: 'test.local', payload: '{}', log: noop, secret: 'secret'});
		expect(gotStub.calledOnce).to.be.true;
		expect(gotStub.args[0][1].body).to.equal('{}');
		gotStub.reset();

		await sendPayload({url: 'test.local', payload: {testing: 'yes'}, log: noop, secret: 'secret'});
		expect(gotStub.calledOnce).to.be.true;
		expect(gotStub.args[0][1].body).to.equal('{"testing":"yes"}');
		gotStub.reset();

		const finalPayload = {
			toString() {
				return '{"this is a test": true}';
			}
		};

		await sendPayload({url: 'test.local', payload: finalPayload, log: noop, secret: 'secret'});
		expect(gotStub.calledOnce).to.be.true;
		expect(gotStub.args[0][1].body).to.equal('{"this is a test": true}');
	});

	it('includes correct hmac and other headers in request', async function () {
		await sendPayload({url: 'test.local', payload: 'testing', log: noop, secret: 'secret'});
		expect(gotStub.calledOnce).to.be.true;
		expect(gotStub.args[0][1].headers).to.deep.equal({
			'Content-Type': 'application/json',
			'User-Agent': _module.userAgent,
			'X-Actions-Secret': TESTING_PAYLOAD_HASH
		});
	});

	it('supports env vars as a fallback', async function () {
		try {
			await sendPayload({payload: 'testing'});
			expect(false, 'error should have been thrown').to.be.true;
		} catch (error) {
			expect(error).to.be.instanceOf(TypeError);
			expect(error.message).to.contain('URL and Secret must be provided');
		}

		try {
			process.env.WEBHOOK_URL = 'webhook.local';
			process.env.WEBHOOK_SECRET = 'webhook';

			await sendPayload({url: 'test.local', payload: 'testing', secret: 'secret', log: noop});

			expect(gotStub.calledOnce).to.be.true;
			expect(gotStub.args[0][0]).to.equal('test.local');
			expect(gotStub.args[0][1].headers).to.have.property('X-Actions-Secret', TESTING_PAYLOAD_HASH);
			gotStub.reset();

			const WEBHOOK_PAYLOAD_HASH = 'sha256=19b7b51b2916ee642e90e5215e9c0505389bbf21c6f68eaa8f501cb510fa587c';

			await sendPayload({payload: 'testing', log: noop});
			expect(gotStub.calledOnce).to.be.true;
			expect(gotStub.args[0][0]).to.equal('webhook.local');
			expect(gotStub.args[0][1].headers).to.have.property('X-Actions-Secret', WEBHOOK_PAYLOAD_HASH);
		} finally {
			delete process.env.WEBHOOK_URL;
			delete process.env.WEBHOOK_SECRET;
		}
	});

	it('throws got errors', async function () {
		const _error = new Error('this is an error');
		gotStub.throws(_error);

		try {
			await sendPayload({url: 'test.local', secret: 'secret', payload: 'test', log: noop});
			expect(false, 'error should have been thrown').to.be.true;
		} catch (error) {
			expect(error).to.equal(_error);
		}
	});

	describe('conditional hooks', function () {
		let originalRef;
		let originalEvent;
		let originalRepo;

		before(function () {
			originalRef = process.env.GITHUB_REF;
			originalEvent = process.env.GITHUB_EVENT_NAME;
			originalRepo = process.env.GITHUB_REPOSITORY;

			process.env.GITHUB_REF = 'refs/heads/develop';
			process.env.GITHUB_EVENT_NAME = 'push';
			process.env.GITHUB_REPOSITORY = 'username/repository';
		});

		after(function () {
			process.env.GITHUB_REF = originalRef;
			process.env.GITHUB_EVENT_NAME = originalEvent;
			process.env.GITHUB_REPOSITORY = originalRepo;
		});

		it('warns when extraneous keys are supplied', async function () {
			const log = sinon.stub();

			await sendPayload({
				url: 'testing.local',
				secret: 'secret',
				payload: 'testing',
				onlyIf: {
					// @ts-ignore
					badKey: false
				},
				log
			});

			expect(log.calledTwice).to.be.true;
			expect(log.args[0][0]).to.contain('unknown filter "badKey"');
		});

		it('fails correctly', async function () {
			await sendPayload({
				url: 'testing.local',
				secret: 'secret',
				payload: 'testing',
				onlyIf: {
					repository: 'username/repo'
				},
				log: noop
			});

			await sendPayload({
				url: 'testing.local',
				secret: 'secret',
				payload: 'testing',
				onlyIf: {
					branch: 'master'
				},
				log: noop
			});

			await sendPayload({
				url: 'testing.local',
				secret: 'secret',
				payload: 'testing',
				onlyIf: {
					isPush: false
				},
				log: noop
			});

			expect(gotStub.called).to.be.false;
		});

		it('passes correctly', async function () {
			await sendPayload({
				url: 'testing.local',
				secret: 'secret',
				payload: 'testing',
				onlyIf: {
					repository: 'username/repository',
					isPush: true,
					branch: 'develop'
				},
				log: noop
			});

			expect(gotStub.calledOnce).to.be.true;
		});

		it('can run in weird environments', async function () {
			delete process.env.GITHUB_REF;

			await sendPayload({
				url: 'testing.local',
				secret: 'secret',
				payload: 'testing',
				onlyIf: {
					isPush: true
				},
				log: noop
			});

			expect(gotStub.calledOnce).to.be.true;
		});
	});
});
