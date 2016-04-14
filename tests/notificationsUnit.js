// This file is written as an AMD module that will be loaded by the Intern
// test client. The test client can load node modules directly to test
// that individual pieces are working as expected.
//
// The flow for each test is generally:
//   1. Load the module you wish to perform unit tests on
//   2. Call the functions of that module directly and use the assert
//      library to verify expected results
//
// More info on writing Unit tests with Intern:
//    https://theintern.github.io/intern/#writing-unit-test
//
// We have chosen to use Intern's "BDD" interface (as opposed to the other
// options that Intern provides - "Object," "TDD," and "QUnit"):
//    https://theintern.github.io/intern/#interface-tdd/
//
// We have chosen to use Chai's "assert" library (as opposed to the other
// options that Chai provides - "expect" and "should"):
//    http://chaijs.com/api/assert/

define((require) => {
  const bdd = require('intern!bdd');
  const chai = require('intern/dojo/node!chai');
  const chaiHttp = require('intern/dojo/node!chai-http');
  chai.use(chaiHttp);
  const assert = chai.assert;

  // This modifies the node module loader to work with es2015 modules.
  // All subsequent `require` calls that use the node module loader
  // will use this modified version and will be able to load es2015
  // modules.
  require('intern/dojo/node!babel-core/register');
  const notifications = require('intern/dojo/node!../../../../engine/notifications');
  const redis = require('intern/dojo/node!../../../../engine/redis-helper').default;

  function register(deviceId, features, endpoint, key, auth) {
    if (Object.prototype.toString.call(features) !== '[object Array]') {
      features = [features];
    }
    return notifications.default.register(deviceId, features, endpoint, key, auth);
  }

  bdd.describe('Notifications unit', () => {
    const nock = require('intern/dojo/node!nock');
    const crypto = require('intern/dojo/node!crypto');
    const urlBase64 = require('intern/dojo/node!urlsafe-base64');
    const userCurve = crypto.createECDH('prime256v1');

    const userPublicKey = userCurve.generateKeys();
    const userKey = urlBase64.encode(userPublicKey);
    const userAuth = urlBase64.encode(crypto.randomBytes(16));

    bdd.after(() => redis.quitClient());

    // clean and quit database after each test
    bdd.afterEach(() => redis.flushdb()
      .then(() => nock.cleanAll())
    );

    bdd.describe('Backend', () => {
      bdd.describe('register', () => {
        bdd.it('should fail if no endpoint provided or stored', () =>
          register('someId', ['feature'], null)
          .catch(err => {
            assert.ok(err);
            assert.equal(err.message, 'No endpoint provided');
          })
        );

        bdd.it('should fail if no features provided', () =>
          register('someId', [], 'http://endpoint')
          .catch(err => {
            assert.ok(err);
            assert.equal(err.message, 'No features provided');
          })
        );

        bdd.it('should save the endpoint and notifications registration and confirm', () => {
          const server = nock('https://localhost:5005')
          .post('/')
          .reply(201);

          return register('someId', ['feature'], 'https://localhost:5005', userKey, userAuth)
          .then(features => {
            assert.include(features, 'feature');
          })
          .then(() =>
            redis.smembers('feature-notifications')
            .then(featureNotifications => {
              assert.lengthOf(featureNotifications, 1);
              assert.strictEqual(featureNotifications[0], 'someId');
            })
            .then(() => redis.smembers('someId-notifications'))
            .then(deviceNotifications => {
              assert.lengthOf(deviceNotifications, 1);
              assert.strictEqual(deviceNotifications[0], 'feature');
            })
            .then(() => redis.hgetall('device-someId')))
          .then(device => {
            assert.isObject(device);
            assert.strictEqual(device.endpoint, 'https://localhost:5005');
            assert.strictEqual(device.key, userKey);
            assert.ok(server.isDone());
          });
        });

        bdd.it('should save work without endpoint if already saved it', () => {
          nock('https://localhost:5005')
          .post('/')
          .times(2)
          .reply(201);

          return register('someId', 'feature', 'https://localhost:5005', userKey, userAuth)
          .then(() => register('someId', 'another-feature'))
          .then(() => redis.hget('device-someId', 'endpoint'))
          .then(endpoint => {
            assert.ok(endpoint);
            assert.strictEqual(endpoint, 'https://localhost:5005');
          });
        });

        bdd.it('should register to a second feature', () => {
          nock('https://localhost:5005')
          .post('/')
          .times(2)
          .reply(201);

          return register('someId', 'feature', 'https://localhost:5005', userKey, userAuth)
          .then(() => register('someId', 'another-feature'))
          .then(() => redis.smembers('someId-notifications'))
          .then(deviceNotifications => {
            assert.lengthOf(deviceNotifications, 2);
            assert.include(deviceNotifications, 'feature');
            assert.include(deviceNotifications, 'another-feature');
          });
        });

        bdd.it('should register many devices to a feature', () => {
          nock('https://localhost:5005')
          .post('/')
          .reply(201);

          nock('https://localhost:5006')
          .post('/')
          .reply(201);

          return register('someId', 'feature', 'https://localhost:5005', userKey, userAuth)
          .then(() => register('anotherId', 'feature', 'http://localhost:5006', userKey, userAuth))
          .then(() => redis.smembers('feature-notifications'))
          .then(featureNotifications => {
            assert.lengthOf(featureNotifications, 2);
            assert.include(featureNotifications, 'someId');
            assert.include(featureNotifications, 'anotherId');
          });
        });

        bdd.it('should register to multiple features in one call', () => {
          nock('https://localhost:5005')
          .post('/')
          .reply(201);

          return register('someId', ['feature', 'another-feature'], 'https://localhost:5005', userKey, userAuth)

          .then(() => redis.smembers('someId-notifications'))
          .then(deviceNotifications => {
            assert.lengthOf(deviceNotifications, 2);
            assert.include(deviceNotifications, 'feature');
            assert.include(deviceNotifications, 'another-feature');
          });
        });
      });

      bdd.describe('all features', () => {
        bdd.it('should add only all except of asking to add many', () => {
          nock('https://localhost:5005')
          .post('/')
          .reply(201);

          return register('someId', ['feature', 'all', 'another-feature'], 'https://localhost:5005', userKey, userAuth)

          .then(() => redis.smembers('someId-notifications'))
          .then(deviceNotifications => {
            assert.lengthOf(deviceNotifications, 1);
            assert.notInclude(deviceNotifications, 'feature');
            assert.notInclude(deviceNotifications, 'another-feature');
            assert.include(deviceNotifications, 'all');
          });
        });

        bdd.it('should remove registration to all', () => {
          nock('https://localhost:5005')
          .post('/')
          .times(2)
          .reply(201);

          return redis.set('status', '{"feature": {"slug": "feature"}, "another-feature": {"slug": "another-feature"}}')
          .then(() => register('someId', 'all', 'https://localhost:5005', userKey, userAuth))
          .then(() => notifications.default.unregister('someId', ['all']))
          .then(() => redis.smembers('someId-notifications'))
          .then(deviceNotifications => {
            assert.lengthOf(deviceNotifications, 0);
          });
        });

        bdd.it('should remove all registrations before adding all', () => {
          nock('https://localhost:5005')
          .post('/')
          .times(2)
          .reply(201);


          return register('someId', ['feature', 'new', 'another-feature'], 'https://localhost:5005', userKey, userAuth)
          .then(() => register('someId', 'all'))
          .then(() => redis.smembers('someId-notifications'))
          .then(deviceNotifications => {
            assert.lengthOf(deviceNotifications, 1);
            assert.include(deviceNotifications, 'all');
          });
        });

        bdd.it('should remove registration to all and register to other features', () => {
          nock('https://localhost:5005')
          .post('/')
          .times(2)
          .reply(201);

          return redis.set('status', '{"feature": {"slug": "feature"}, "another-feature": {"slug": "another-feature"}}')
          .then(() => register('someId', 'all', 'https://localhost:5005', userKey, userAuth))
          .then(() => notifications.default.unregister('someId', ['another-feature']))
          .then(() => redis.smembers('someId-notifications'))
          .then(deviceNotifications => {
            assert.lengthOf(deviceNotifications, 2);
            assert.notInclude(deviceNotifications, 'all');
            assert.include(deviceNotifications, 'feature');
            assert.include(deviceNotifications, 'new');
          });
        });
      });

      bdd.describe('registered features', () => {
        bdd.it('should fail if no deviceId', () =>
          notifications.default.getRegisteredFeatures('someId')
          .catch(err => {
            assert.ok(err);
            assert.strictEqual(err.message, 'Not Found');
          })
        );

        bdd.it('should return saved notifications', () => {
          nock('https://localhost:5005')
          .post('/')
          .reply(201);

          return register('someId', ['feature', 'another-feature'], 'https://localhost:5005', userKey, userAuth)
          .then(() => notifications.default.getRegisteredFeatures('someId'))
          .then(deviceNotifications => {
            assert.isArray(deviceNotifications);
            assert.lengthOf(deviceNotifications, 2);
            assert.include(deviceNotifications, 'feature');
            assert.include(deviceNotifications, 'another-feature');
          });
        });
      });

      bdd.describe('unregister', () => {
        bdd.it('should fail if no deviceId', () =>
          notifications.default.unregister('notExistingId')
          .catch(err => {
            assert.ok(err);
            assert.strictEqual(err.message, 'Not Found');
          })
        );

        bdd.it('should unregister from a notification', () => {
          nock('https://localhost:5005')
          .post('/')
          .times(2)
          .reply(201);

          return register('someId', ['feature', 'another-feature'], 'https://localhost:5005', userKey, userAuth)
          .then(() => notifications.default.unregister('someId', ['feature']))
          .then(() => notifications.default.getRegisteredFeatures('someId'))
          .then(deviceNotifications => {
            assert.isArray(deviceNotifications);
            assert.lengthOf(deviceNotifications, 1);
            assert.include(deviceNotifications, 'another-feature');
          });
        });

        bdd.it('should unregister and remove device', () => {
          nock('https://localhost:5005')
          .post('/')
          .times(2)
          .reply(201);

          return register('someId', ['feature', 'another-feature'], 'https://localhost:5005', userKey, userAuth)
          .then(() => notifications.default.unregister('someId', null))
          .then(() => notifications.default.getRegisteredFeatures('someId'))
          .catch(err => {
            console.log(err);
            assert.ok(err);
            assert.strictEqual(err.message, 'Not Found');
          });
        });
      });

      bdd.describe('update endpoint', () => {
        bdd.it('should fail if no deviceId', () =>
          notifications.default.updateDevice('someId', 'http://endpoint', null, null)
          .catch(err => {
            assert.ok(err);
            assert.strictEqual(err.message, 'Not Found');
          })
        );

        bdd.it('should fail if no endpoint', () => {
          nock('https://localhost:5005')
          .post('/')
          .times(2)
          .reply(201);

          return register('someId', 'feature', 'https://localhost:5005', userKey, userAuth)
          .then(() => notifications.default.updateDevice('someId', null, null, null))
          .catch(err => {
            assert.ok(err);
            assert.strictEqual(err.message, 'No endpoint provided');
          });
        });

        bdd.it('should set endpoint, key and auth', () => {
          nock('https://localhost:5005')
          .post('/')
          .times(2)
          .reply(201);

          return register('someId', 'feature', 'https://localhost:5005', userKey, userAuth)
          .then(() => notifications.default.updateDevice('someId', 'http://another-endpoint', 'otherKey', 'otherAuth'))
          .then(() => redis.hgetall('device-someId'))
          .then(device => {
            assert.ok(device);
            assert.strictEqual(device.endpoint, 'http://another-endpoint');
            assert.strictEqual(device.key, 'otherKey');
            assert.strictEqual(device.authSecret, 'otherAuth');
          });
        });
      });
    });

    bdd.describe('Sending Notifications', () => {
      bdd.describe('send notification', () => {
        bdd.it('should post to endpoint', () => {
          const service = nock('https://localhost:5005')
          .post('/')
          .times(2)
          .reply(201);

          return register('someId', 'feature', 'https://localhost:5005/', userKey, userAuth)
          .then(() => notifications.default.sendNotifications('feature', {}, false))
          .then(() => {
            assert.ok(service.isDone());
          });
        });

        bdd.it('should not create a payload key if sending to non GCM endpoint with payload', () => {
          nock('https://localhost:5005')
          .post('/')
          .times(2)
          .reply(201);

          return register('someId', 'feature', 'https://localhost:5005/', userKey, userAuth)
          .then(() => notifications.default.sendNotifications('feature', { body: 'hello' }, false))
          .then(() => redis.get('someId-payload'))
          .then(payload => {
            assert.notOk(payload);
          });
        });

        bdd.it('should post to GCM endpoint (Chrome < 50) and create a payload', () => {
          const service = nock('https://android.googleapis.com')
          .post('/gcm')
          .times(2)
          .reply(200);

          return register('someId', 'feature', 'https://android.googleapis.com/gcm/send', '', '')
          .then(() => notifications.default.sendNotifications('feature', { body: 'hello' }, false))
          .then(() => notifications.default.getPayload('someId'))
          .then(payload => {
            assert.deepEqual(payload, { body: 'hello' });
            assert.ok(service.isDone());
          });
        });

        bdd.it('should delete payload after providing it', () =>
          redis.set('someId-payload', '{"body": "hello"}')
          .then(() => notifications.default.getPayload('someId'))
          .then(() => redis.get('someId-payload'))
          .then(payload => {
            assert.notOk(payload);
          })
        );

        bdd.it('should post to GCM endpoint', () => {
          const service = nock('https://android.googleapis.com')
          .post('/gcm')
          .times(2)
          .reply(200);

          return register('someId', 'feature', 'https://android.googleapis.com/gcm/send', '', '')
          .then(() => notifications.default.sendNotifications('feature', { body: 'hello' }, false))
          .then(() => {
            assert.ok(service.isDone());
          });
        });

        bdd.it('should post if someone registered to all', () => {
          const serviceA = nock('https://localhost:5005')
          .post('/')
          .times(2)
          .reply(201);

          const serviceB = nock('https://localhost:5006')
          .post('/')
          .times(2)
          .reply(201);

          return register('someId', 'feature', 'https://localhost:5005/', userKey, userAuth)
          .then(() => register('anotherId', 'all', 'https://localhost:5006/', userKey, userAuth))
          .then(() => notifications.default.sendNotifications('feature', {}, false))
          .then(() => {
            assert.ok(serviceA.isDone(), 'is serviceA called');
            assert.ok(serviceB.isDone(), 'is serviceB called');
          });
        });

        bdd.it('should post if someone registered to new', () => {
          const service = nock('https://localhost:5005')
          .post('/')
          .times(2)
          .reply(201);

          return register('someId', 'new', 'https://localhost:5005/', userKey, userAuth)
          .then(() => notifications.default.sendNotifications('feature', {}, true))
          .then(() => {
            assert.ok(service.isDone(), 'is service called');
          });
        });

        bdd.it('should post to multiple endpoints', () => {
          const serviceA = nock('https://localhost:5005')
          .post('/')
          .times(2)
          .reply(201);

          const serviceB = nock('https://localhost:5006')
          .post('/')
          .times(2)
          .reply(201);

          return register('someId', 'feature', 'https://localhost:5005/', userKey, userAuth)
          .then(() => register('anotherId', 'feature', 'https://localhost:5006/', userKey, userAuth))
          .then(() => notifications.default.sendNotifications('feature', {}, false))
          .then(() => {
            assert.ok(serviceA.isDone(), 'is serviceA called');
            assert.ok(serviceB.isDone(), 'is serviceB called');
          });
        });
      });
    });

    bdd.describe('Link with checkNewFeatures', () => {
      const engine = require('intern/dojo/node!../../../../engine/index');

      bdd.it('should resolve if nothing to notify about', () => {
        const testData = [{
          slug: 'feature',
          firefox_status: 'first',
          b: 'value B',
          updated: {},
        }];

        return engine.test.sendNotifications(testData)
        .then(() => {
          assert.ok(true);
        });
      });

      bdd.it('should resolve if noone to notify', () => {
        const testData = [{
          slug: 'feature',
          firefox_status: 'first',
          b: 'value B',
          updated: {},
          just_started: true,
        }];

        return engine.test.sendNotifications(testData)
        .then(() => {
          assert.ok(true);
        });
      });

      bdd.it('should notify about new entries', () => {
        const service = nock('https://localhost:5005')
        .post('/')
        .times(3)
        .reply(201);

        const testData = [{
          slug: 'another-feature',
          firefox_status: 'first',
          updated: {},
          just_started: true,
        }, {
          slug: 'feature',
          firefox_status: 'first',
          updated: {},
          just_started: true,
        }];

        return register('someId', 'all', 'https://localhost:5005/', userKey, userAuth)
        .then(() => engine.test.sendNotifications(testData))
        .then(() => {
          assert.ok(service.isDone());
        });
      });
    });

    bdd.describe('API', () => {
      const portfinder = require('intern/dojo/node!portfinder');
      const platatus = require('intern/dojo/node!../app');

      var port;
      var server;
      function api() {
        return chai.request(`http://localhost:${port}`);
      }

      bdd.before(() => new Promise((resolve) => {
        portfinder.getPort((err, receivedPort) => {
          port = receivedPort;
          server = platatus.listen(port, () => {
            console.log('server is running on port %j', port);
            resolve();
          });
        });
      }));

      bdd.after(() => server.close());

      bdd.it('registers a device', () => {
        nock('https://localhost:5005')
        .post('/')
        .reply(201);

        return api()
        .post('/register')
        .send({
          deviceId: 'someId',
          endpoint: 'https://localhost:5005',
          key: userKey,
          features: ['feature', 'another-feature'],
        })
        .then(response => {
          assert.property(response.body, 'features');
          assert.isArray(response.body.features);
          assert.sameMembers(response.body.features, ['feature', 'another-feature']);
        })
        .then(() => redis.hgetall('device-someId'))
        .then(device => {
          assert.ok(device);
          assert.strictEqual(device.endpoint, 'https://localhost:5005');
          assert.strictEqual(device.key, userKey);
        })
        .then(() => redis.smembers('someId-notifications'))
        .then(deviceNotifications => {
          assert.lengthOf(deviceNotifications, 2);
          assert.include(deviceNotifications, 'feature');
          assert.include(deviceNotifications, 'another-feature');
        })
        .then(() => redis.smembers('feature-notifications'))
        .then(featureNotifications => {
          assert.lengthOf(featureNotifications, 1);
          assert.include(featureNotifications, 'someId');
        })
        .then(() => redis.smembers('another-feature-notifications'))
        .then(featureNotifications => {
          assert.lengthOf(featureNotifications, 1);
          assert.include(featureNotifications, 'someId');
        });
      });

      bdd.it('/registrations returns an array with registrations for device', () => {
        nock('https://localhost:5005')
        .post('/')
        .reply(201);

        return register('someId', ['feature', 'another-feature'], 'https://localhost:5005/', userKey, userAuth)
        .then(() => api()
          .get('/registrations/someId')
          .send())
        .then(response => {
          assert.equal(response.status, 200);
          assert.isArray(response.body.features);
          assert.include(response.body.features, 'feature');
          assert.include(response.body.features, 'another-feature');
        });
      });

      bdd.it('/registrations replies with 404 if no registrations for the user', () => {
        nock('https://localhost:5005')
        .post('/')
        .reply(201);

        return register('someId', ['feature', 'another-feature'], 'https://localhost:5005/', userKey, userAuth)
        .then(() => api()
          .get('/registrations/someOtherId')
          .send())
        .catch(err => {
          assert.strictEqual(err.response.statusCode, 404);
        });
      });

      bdd.it('/unregister removes only from the another-feature', () => {
        nock('https://localhost:5005')
        .post('/')
        .times(2)
        .reply(201);

        return register('someId', ['feature', 'another-feature'], 'https://localhost:5005/', userKey, userAuth)
        .then(() => api()
          .post('/unregister')
          .send({
            deviceId: 'someId',
            features: ['another-feature'],
          }))
        .then(response => {
          assert.equal(response.status, 200);
        })
        .then(() => redis.smembers('someId-notifications'))
        .then(deviceNotifications => {
          assert.lengthOf(deviceNotifications, 1);
          assert.strictEqual(deviceNotifications[0], 'feature');
        })
        .then(() => redis.smembers('feature-notifications'))
        .then(featureNotifications => {
          assert.lengthOf(featureNotifications, 1);
          assert.strictEqual(featureNotifications[0], 'someId');
        })
        .then(() => redis.smembers('another-feature-notifications'))
        .then(featureNotifications => {
          assert.lengthOf(featureNotifications, 0);
        });
      });

      bdd.it('/unregister removes all device info', () => {
        nock('https://localhost:5005')
        .post('/')
        .times(2)
        .reply(201);

        return register('someId', ['feature', 'another-feature'], 'https://localhost:5005/', userKey, userAuth)
        .then(() => api()
          .post('/unregister')
          .send({
            deviceId: 'someId',
          }))
        .then(response => {
          assert.equal(response.status, 200);
        })
        .then(() => redis.smembers('someId-notifications'))
        .then(deviceNotifications => {
          assert.lengthOf(deviceNotifications, 0);
        })
        .then(() => redis.smembers('feature-notifications'))
        .then(featureNotifications => {
          assert.lengthOf(featureNotifications, 0);
        })
        .then(() => redis.smembers('another-feature-notifications'))
        .then(featureNotifications => {
          assert.lengthOf(featureNotifications, 0);
        })
        .then(() => redis.hgetall('device-deviceId'))
        .then(device => {
          assert.notOk(device);
        });
      });

      bdd.it('/update_device changes the endpoint info', () => {
        nock('https://localhost:5005')
        .post('/')
        .reply(201);

        return register('someId', 'feature', 'https://localhost:5005/', userKey, userAuth)
        .then(() => api()
          .put('/update_device')
          .send({
            deviceId: 'someId',
            endpoint: 'https://localhost:5006/',
            key: 'anotherkey',
          }))
        .then(response => {
          assert.equal(response.status, 200);
        })
        .then(() => redis.hgetall('device-someId'))
        .then(device => {
          assert.isObject(device);
          assert.strictEqual(device.endpoint, 'https://localhost:5006/');
          assert.strictEqual(device.key, 'anotherkey');
        });
      });

      bdd.it('/update_device replies with 404 if no registrations for the device', () =>
        api()
        .put('/update_device')
        .send({
          deviceId: 'someId',
          endpoint: 'https://localhost:5006/',
          key: 'anotherkey',
        })
        .catch(err => {
          assert.strictEqual(err.response.statusCode, 404);
        })
      );
    });
  });
});