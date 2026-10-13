export const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'Alayn Operations & Management Platform API',
    description: 'Phase 1 Backend API documentation',
    version: '1.0.0',
  },
  servers: [
    {
      url: 'http://localhost:3000',
      description: 'Development server',
    },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
  },
  security: [
    {
      BearerAuth: [],
    },
  ],
  paths: {
    '/api/v1/auth/login': {
      post: {
        summary: 'User Login',
        tags: ['Authentication'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  email: { type: 'string', example: 'owner@alayn.com' },
                  password: { type: 'string', example: 'password123' },
                },
                required: ['email', 'password'],
              },
            },
          },
        },
        responses: {
          200: { description: 'Success' },
          401: { description: 'Invalid Credentials' },
        },
      },
    },
    '/api/v1/auth/refresh': {
      post: {
        summary: 'Refresh Access Token',
        tags: ['Authentication'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  refreshToken: { type: 'string' },
                },
                required: ['refreshToken'],
              },
            },
          },
        },
        responses: {
          200: { description: 'Success' },
        },
      },
    },
    '/api/v1/auth/logout': {
      post: {
        summary: 'Logout User',
        tags: ['Authentication'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  refreshToken: { type: 'string' },
                },
                required: ['refreshToken'],
              },
            },
          },
        },
        responses: {
          200: { description: 'Success' },
        },
      },
    },
    '/api/v1/employees': {
      post: {
        summary: 'Create Employee Profile',
        tags: ['Employees'],
        parameters: [{ name: 'x-outlet-id', in: 'header', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string', example: 'Sam Staff' },
                  phone: { type: 'string', example: '9876543210' },
                  role: { type: 'string', example: 'STAFF' },
                  joiningDate: { type: 'string', format: 'date', example: '2025-02-01' },
                  status: { type: 'string', example: 'ACTIVE' },
                  userId: { type: 'string', format: 'uuid' },
                },
                required: ['name', 'phone', 'role', 'joiningDate'],
              },
            },
          },
        },
        responses: {
          201: { description: 'Created' },
        },
      },
      get: {
        summary: 'List Employees',
        tags: ['Employees'],
        parameters: [
          { name: 'x-outlet-id', in: 'header', required: true, schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
          { name: 'offset', in: 'query', schema: { type: 'integer' } },
        ],
        responses: {
          200: { description: 'Success' },
        },
      },
    },
    '/api/v1/employees/{id}': {
      patch: {
        summary: 'Update Employee Profile',
        tags: ['Employees'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'x-outlet-id', in: 'header', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  phone: { type: 'string' },
                  status: { type: 'string', example: 'ACTIVE' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Success' },
        },
      },
    },
    '/api/v1/employees/{id}/documents': {
      post: {
        summary: 'Upload Employee Document',
        tags: ['Employees'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'x-outlet-id', in: 'header', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  document: { type: 'string', format: 'binary' },
                },
                required: ['document'],
              },
            },
          },
        },
        responses: {
          201: { description: 'Created' },
        },
      },
    },
    '/api/v1/shifts': {
      post: {
        summary: 'Create Shift Template',
        tags: ['Shifts'],
        parameters: [{ name: 'x-outlet-id', in: 'header', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string', example: 'Morning Shift' },
                  startTime: { type: 'string', example: '09:00' },
                  endTime: { type: 'string', example: '12:00' },
                },
                required: ['name', 'startTime', 'endTime'],
              },
            },
          },
        },
        responses: {
          201: { description: 'Created' },
        },
      },
    },
    '/api/v1/shifts/{id}/assign': {
      post: {
        summary: 'Assign Employee to Shift',
        tags: ['Shifts'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'x-outlet-id', in: 'header', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  employeeId: { type: 'string', format: 'uuid' },
                  date: { type: 'string', format: 'date', example: '2025-06-15' },
                },
                required: ['employeeId', 'date'],
              },
            },
          },
        },
        responses: {
          201: { description: 'Created' },
          400: { description: 'Shift Overlap' },
        },
      },
    },
    '/api/v1/shifts/swaps': {
      post: {
        summary: 'Request Shift Swap',
        tags: ['Shifts'],
        parameters: [{ name: 'x-outlet-id', in: 'header', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  fromEmployeeId: { type: 'string', format: 'uuid' },
                  toEmployeeId: { type: 'string', format: 'uuid' },
                  shiftId: { type: 'string', format: 'uuid' },
                  date: { type: 'string', format: 'date', example: '2025-06-15' },
                },
                required: ['fromEmployeeId', 'toEmployeeId', 'shiftId', 'date'],
              },
            },
          },
        },
        responses: {
          201: { description: 'Created' },
        },
      },
    },
    '/api/v1/shifts/swaps/{id}': {
      patch: {
        summary: 'Approve or Reject Shift Swap',
        tags: ['Shifts'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'x-outlet-id', in: 'header', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string', enum: ['APPROVED', 'REJECTED'] },
                },
                required: ['status'],
              },
            },
          },
        },
        responses: {
          200: { description: 'Success' },
        },
      },
    },
    '/api/v1/attendance/check-in': {
      post: {
        summary: 'Employee Attendance Check-In',
        tags: ['Attendance'],
        parameters: [{ name: 'x-outlet-id', in: 'header', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  employeeId: { type: 'string', format: 'uuid' },
                },
                required: ['employeeId'],
              },
            },
          },
        },
        responses: {
          201: { description: 'Created' },
        },
      },
    },
    '/api/v1/attendance/check-out': {
      post: {
        summary: 'Employee Attendance Check-Out',
        tags: ['Attendance'],
        parameters: [{ name: 'x-outlet-id', in: 'header', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  employeeId: { type: 'string', format: 'uuid' },
                },
                required: ['employeeId'],
              },
            },
          },
        },
        responses: {
          200: { description: 'Success' },
        },
      },
    },
    '/api/v1/leave-requests': {
      post: {
        summary: 'Create Leave Request',
        tags: ['Leave Requests'],
        parameters: [{ name: 'x-outlet-id', in: 'header', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  employeeId: { type: 'string', format: 'uuid' },
                  startDate: { type: 'string', format: 'date', example: '2025-07-01' },
                  endDate: { type: 'string', format: 'date', example: '2025-07-05' },
                  reason: { type: 'string', example: 'Family function' },
                },
                required: ['employeeId', 'startDate', 'endDate', 'reason'],
              },
            },
          },
        },
        responses: {
          201: { description: 'Created' },
        },
      },
    },
    '/api/v1/leave-requests/{id}': {
      patch: {
        summary: 'Approve or Reject Leave Request',
        tags: ['Leave Requests'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'x-outlet-id', in: 'header', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string', enum: ['APPROVED', 'REJECTED'] },
                },
                required: ['status'],
              },
            },
          },
        },
        responses: {
          200: { description: 'Success' },
        },
      },
    },
    '/api/v1/inventory/items': {
      post: {
        summary: 'Create Inventory Item',
        tags: ['Inventory'],
        parameters: [{ name: 'x-outlet-id', in: 'header', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string', example: 'Milk' },
                  sku: { type: 'string', example: 'MILK-001' },
                  category: { type: 'string', example: 'Dairy' },
                  unit: { type: 'string', example: 'liters' },
                  reorderThreshold: { type: 'number', example: 5.0 },
                  unitCostPaise: { type: 'integer', example: 6000 },
                },
                required: ['name', 'sku', 'category', 'unit', 'reorderThreshold', 'unitCostPaise'],
              },
            },
          },
        },
        responses: {
          201: { description: 'Created' },
        },
      },
    },
    '/api/v1/inventory/items/{id}/stock': {
      get: {
        summary: 'Get Stock Balance of Item',
        tags: ['Inventory'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'x-outlet-id', in: 'header', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'Success' },
        },
      },
    },
    '/api/v1/inventory/items/{id}/adjust': {
      post: {
        summary: 'Manually Adjust Stock',
        tags: ['Inventory'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'x-outlet-id', in: 'header', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  change: { type: 'number', example: 10.0 },
                  reason: { type: 'string', enum: ['SALE', 'WASTE', 'PURCHASE', 'ADJUSTMENT'] },
                },
                required: ['change'],
              },
            },
          },
        },
        responses: {
          201: { description: 'Created' },
        },
      },
    },
    '/api/v1/inventory/recipes': {
      post: {
        summary: 'Create Recipe Link',
        tags: ['Inventory'],
        parameters: [{ name: 'x-outlet-id', in: 'header', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  menuItemId: { type: 'string', format: 'uuid' },
                  itemId: { type: 'string', format: 'uuid' },
                  quantityPerUnit: { type: 'number', example: 0.1 },
                },
                required: ['menuItemId', 'itemId', 'quantityPerUnit'],
              },
            },
          },
        },
        responses: {
          201: { description: 'Created' },
        },
      },
    },
    '/api/v1/purchase-orders': {
      post: {
        summary: 'Create Purchase Order',
        tags: ['Purchase Orders'],
        parameters: [{ name: 'x-outlet-id', in: 'header', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  supplierId: { type: 'string', format: 'uuid' },
                  items: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        itemId: { type: 'string', format: 'uuid' },
                        orderedQuantity: { type: 'number', example: 100 },
                        unitCostPaise: { type: 'integer', example: 5500 },
                      },
                      required: ['itemId', 'orderedQuantity', 'unitCostPaise'],
                    },
                  },
                },
                required: ['supplierId', 'items'],
              },
            },
          },
        },
        responses: {
          201: { description: 'Created' },
        },
      },
    },
    '/api/v1/purchase-orders/{id}/receive': {
      patch: {
        summary: 'Receive Goods on Purchase Order',
        tags: ['Purchase Orders'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'x-outlet-id', in: 'header', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  items: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        itemId: { type: 'string', format: 'uuid' },
                        receivedQuantity: { type: 'number', example: 50 },
                        batchNumber: { type: 'string', example: 'BAT-XYZ' },
                        expiryDate: { type: 'string', format: 'date', example: '2026-07-01' },
                      },
                      required: ['itemId', 'receivedQuantity', 'batchNumber', 'expiryDate'],
                    },
                  },
                },
                required: ['items'],
              },
            },
          },
        },
        responses: {
          200: { description: 'Success' },
        },
      },
    },
    '/api/v1/menu': {
      get: {
        summary: 'Get Public Outlet Menu',
        tags: ['Menu'],
        parameters: [{ name: 'x-outlet-id', in: 'header', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Success' },
        },
      },
    },
    '/api/v1/menu/categories': {
      post: {
        summary: 'Create Menu Category',
        tags: ['Menu'],
        parameters: [{ name: 'x-outlet-id', in: 'header', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string', example: 'Beverages' },
                  description: { type: 'string' },
                  isActive: { type: 'boolean' },
                },
                required: ['name'],
              },
            },
          },
        },
        responses: {
          201: { description: 'Created' },
        },
      },
    },
    '/api/v1/menu/items': {
      post: {
        summary: 'Create Menu Item',
        tags: ['Menu'],
        parameters: [{ name: 'x-outlet-id', in: 'header', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string', example: 'Cappuccino' },
                  description: { type: 'string' },
                  pricePaise: { type: 'integer', example: 12000 },
                  categoryId: { type: 'string', format: 'uuid' },
                  isActive: { type: 'boolean' },
                },
                required: ['name', 'pricePaise', 'categoryId'],
              },
            },
          },
        },
        responses: {
          201: { description: 'Created' },
        },
      },
    },
    '/api/v1/menu/items/{id}/cost': {
      get: {
        summary: 'Calculate Menu Item Ingredient Cost',
        tags: ['Menu'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'x-outlet-id', in: 'header', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'Success' },
        },
      },
    },
    '/api/v1/orders': {
      post: {
        summary: 'Place Order',
        tags: ['Orders'],
        description: 'Accepts employee authentication or a valid QR TableToken in body',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  tableNumber: { type: 'integer' },
                  source: { type: 'string', enum: ['COUNTER', 'QR', 'DELIVERY'] },
                  tableToken: { type: 'string' },
                  items: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        menuItemId: { type: 'string', format: 'uuid' },
                        quantity: { type: 'integer', example: 2 },
                      },
                      required: ['menuItemId', 'quantity'],
                    },
                  },
                },
                required: ['source', 'items'],
              },
            },
          },
        },
        responses: {
          201: { description: 'Created' },
        },
      },
    },
    '/api/v1/orders/{id}/status': {
      patch: {
        summary: 'Update Order Status',
        tags: ['Orders'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'x-outlet-id', in: 'header', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string', enum: ['RECEIVED', 'PREPARING', 'READY', 'SERVED', 'DISPATCHED', 'COMPLETED', 'CANCELLED'] },
                  comment: { type: 'string' },
                },
                required: ['status'],
              },
            },
          },
        },
        responses: {
          200: { description: 'Success' },
          400: { description: 'Insufficient stock on completing' },
        },
      },
    },
    '/api/v1/orders/{id}/payments': {
      post: {
        summary: 'Record Payment',
        tags: ['Orders'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'x-outlet-id', in: 'header', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  amountPaise: { type: 'integer', example: 10000 },
                  method: { type: 'string', enum: ['UPI', 'CARD', 'CASH'] },
                  status: { type: 'string', enum: ['PENDING', 'CONFIRMED', 'FAILED'] },
                },
                required: ['amountPaise', 'method'],
              },
            },
          },
        },
        responses: {
          201: { description: 'Created' },
        },
      },
    },
    '/api/v1/kitchen/orders': {
      get: {
        summary: 'Get Active Kitchen Orders',
        tags: ['Kitchen'],
        parameters: [{ name: 'x-outlet-id', in: 'header', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Success' },
        },
      },
    },
    '/api/v1/tables/{token}/menu': {
      get: {
        summary: 'Get Table Menu via QR Token',
        tags: ['QR Ordering'],
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Success' },
        },
      },
    },
    '/api/v1/waste-logs': {
      post: {
        summary: 'Log Food Waste',
        tags: ['Waste Management'],
        parameters: [{ name: 'x-outlet-id', in: 'header', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  itemId: { type: 'string', format: 'uuid' },
                  quantity: { type: 'number', example: 1.5 },
                  reason: { type: 'string', enum: ['SPOILAGE', 'OVER_PREP', 'RETURN', 'ERROR'] },
                },
                required: ['itemId', 'quantity', 'reason'],
              },
            },
          },
        },
        responses: {
          201: { description: 'Created' },
        },
      },
      get: {
        summary: 'List Waste Logs',
        tags: ['Waste Management'],
        parameters: [
          { name: 'x-outlet-id', in: 'header', required: true, schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
          { name: 'offset', in: 'query', schema: { type: 'integer' } },
        ],
        responses: {
          200: { description: 'Success' },
        },
      },
    },
    '/api/v1/waste-logs/summary': {
      get: {
        summary: 'Get Waste Summary',
        tags: ['Waste Management'],
        parameters: [{ name: 'x-outlet-id', in: 'header', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Success' },
        },
      },
    },
    '/api/v1/analytics/daily-summary': {
      get: {
        summary: 'Get Daily Sales Summaries',
        tags: ['Analytics'],
        parameters: [
          { name: 'x-outlet-id', in: 'header', required: true, schema: { type: 'string' } },
          { name: 'startDate', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'endDate', in: 'query', schema: { type: 'string', format: 'date' } },
        ],
        responses: {
          200: { description: 'Success' },
        },
      },
    },
    '/api/v1/analytics/best-worst-sellers': {
      get: {
        summary: 'Get Best and Worst Sellers',
        tags: ['Analytics'],
        parameters: [{ name: 'x-outlet-id', in: 'header', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Success' },
        },
      },
    },
    '/api/v1/analytics/reports': {
      get: {
        summary: 'Get Sales Performance Reports',
        tags: ['Analytics'],
        parameters: [
          { name: 'x-outlet-id', in: 'header', required: true, schema: { type: 'string' } },
          { name: 'startDate', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'endDate', in: 'query', schema: { type: 'string', format: 'date' } },
        ],
        responses: {
          200: { description: 'Success' },
        },
      },
    },
    '/api/v1/analytics/outlet-comparison': {
      get: {
        summary: 'Compare Outlets (Cached)',
        tags: ['Analytics'],
        responses: {
          200: { description: 'Success' },
        },
      },
    },
    '/api/v1/feedback': {
      post: {
        summary: 'Submit Customer Feedback',
        tags: ['Feedback & Tickets'],
        description: 'Public endpoint, rate-limited',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  orderId: { type: 'string', format: 'uuid' },
                  rating: { type: 'integer', example: 5 },
                  comment: { type: 'string', example: 'Great food, minor allergy concern' },
                },
                required: ['orderId', 'rating', 'comment'],
              },
            },
          },
        },
        responses: {
          201: { description: 'Created' },
        },
      },
    },
    '/api/v1/staff-queries': {
      post: {
        summary: 'Log Staff Query',
        tags: ['Feedback & Tickets'],
        parameters: [{ name: 'x-outlet-id', in: 'header', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  employeeId: { type: 'string', format: 'uuid' },
                  category: { type: 'string', example: 'Payroll' },
                  description: { type: 'string', example: 'Incorrect shift calculation' },
                },
                required: ['employeeId', 'category', 'description'],
              },
            },
          },
        },
        responses: {
          201: { description: 'Created' },
        },
      },
    },
    '/api/v1/tickets': {
      get: {
        summary: 'List Tickets',
        tags: ['Feedback & Tickets'],
        parameters: [
          { name: 'x-outlet-id', in: 'header', required: true, schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
          { name: 'offset', in: 'query', schema: { type: 'integer' } },
        ],
        responses: {
          200: { description: 'Success' },
        },
      },
    },
    '/api/v1/tickets/{id}': {
      patch: {
        summary: 'Update Ticket Status/Resolve',
        tags: ['Feedback & Tickets'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'x-outlet-id', in: 'header', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string', enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED'] },
                  comment: { type: 'string' },
                },
                required: ['status'],
              },
            },
          },
        },
        responses: {
          200: { description: 'Success' },
        },
      },
    },
  },
};
