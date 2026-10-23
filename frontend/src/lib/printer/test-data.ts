/**
 * Print Test Utilities
 * 
 * This file provides test data and utilities to verify the printing
 * capabilities without needing actual orders/bills.
 */

import type { Bill, Order, Tenant, Customer, OrderItem, Table } from '@/lib/types';

/**
 * Generate a test bill for printing tests
 */
export function createTestBill(overrides?: Partial<Bill>): Bill {
  const testOrder = createTestOrder();
  
  return {
    id: 1,
    bill_number: 'BILL-001',
    order_id: testOrder.id,
    customer_id: testOrder.customer_id,
    subtotal: 450,
    tax_amount: 54,
    discount_amount: 0,
    service_charge: 0,
    delivery_charge: 0,
    total: 504,
    paid_amount: 504,
    balance: 0,
    payment_status: 'paid',
    payment_details: [
      { method: 'cash', amount: 504, timestamp: new Date().toISOString() },
    ],
    tax_breakdown: [
      { title: 'CGST', rate: 6, amount: 27 },
      { title: 'SGST', rate: 6, amount: 27 },
    ],
    order: testOrder,
    ...overrides,
  };
}

/**
 * Generate a test order for KOT tests
 */
export function createTestOrder(overrides?: Partial<Order>): Order {
  const testTable: Table = {
    id: 1,
    name: 'Table 5',
    capacity: 4,
    status: 'occupied',
    kitchen_station_id: 1,
    floor: 'Ground',
    section: 'Main',
    is_active: true,
  };

  const testCustomer: Customer = {
    id: 1,
    phone: '9876543210',
    country_code: '+91',
    name: 'John Doe',
    email: 'john@example.com',
    visits_count: 5,
    total_spent: 2500,
    last_visit_at: new Date().toISOString(),
    wallet_balance: 100,
  };

  const testItems: OrderItem[] = [
    {
      id: 1,
      order_id: 1,
      product_id: 1,
      product_name: 'Chicken Biryani',
      product_sku: 'BIR-001',
      unit_price: 180,
      quantity: 2,
      subtotal: 360,
      tax_amount: 18,
      total: 378,
      addons: [
        { id: 1, name: 'Extra Spice', price: 20 },
      ],
      special_instructions: 'Less onion',
      status: 'pending',
    },
    {
      id: 2,
      order_id: 1,
      product_id: 2,
      product_name: 'Tandoori Roti',
      product_sku: 'ROT-001',
      unit_price: 30,
      quantity: 4,
      subtotal: 120,
      tax_amount: 6,
      total: 126,
      addons: null,
      special_instructions: null,
      status: 'pending',
    },
    {
      id: 3,
      order_id: 1,
      product_id: 3,
      product_name: 'Masala Papad',
      product_sku: 'PAP-001',
      unit_price: 50,
      quantity: 1,
      subtotal: 50,
      tax_amount: 2.5,
      total: 52.5,
      addons: null,
      special_instructions: null,
      status: 'ready',
    },
  ];

  return {
    id: 1,
    order_number: 'ORD-001',
    table_id: testTable.id,
    customer_id: testCustomer.id,
    type: 'dine_in',
    status: 'preparing',
    subtotal: 530,
    tax_amount: 53,
    discount_amount: 0,
    delivery_charge: 0,
    total: 583,
    guest_count: 3,
    special_instructions: 'Birthday celebration',
    created_by: 1,
    created_at: new Date().toISOString(),
    items: testItems,
    table: testTable,
    customer: testCustomer,
    ...overrides,
  };
}

/**
 * Generate a test tenant for printing
 */
export function createTestTenant(overrides?: Partial<Tenant>): Tenant {
  return {
    id: 1,
    business_name: 'Test Restaurant',
    slug: 'test-restaurant',
    database_name: 'tenant_test_restaurant',
    business_type: 'restaurant',
    country: 'IN',
    currency: '₹',
    timezone: 'Asia/Kolkata',
    plan: 'trial',
    status: 'active',
    ...overrides,
  };
}

/**
 * Generate a test customer for WhatsApp sharing
 */
export function createTestCustomer(overrides?: Partial<Customer>): Customer {
  return {
    id: 1,
    phone: '9876543210',
    country_code: '+91',
    name: 'John Doe',
    email: 'john@example.com',
    visits_count: 5,
    total_spent: 2500,
    last_visit_at: new Date().toISOString(),
    wallet_balance: 150,
    ...overrides,
  };
}

/**
 * Exact Pizza Mafia Reference Receipt Data
 */
export function createPizzaMafiaTestOrder(): Order {
  return {
    id: 4,
    order_number: '4',
    type: 'takeaway',
    status: 'completed',
    subtotal: 170,
    total: 170,
    tax_amount: 0,
    discount_amount: 0,
    delivery_charge: 0,
    table_id: null,
    customer_id: 10,
    guest_count: 1,
    special_instructions: null,
    created_by: 1,
    created_at: '2026-09-09T15:31:04.000Z',
    customer: {
      id: 10,
      name: 'mubeen',
      phone: '03001234567',
      country_code: '+92',
      email: 'mubeen@example.com',
      visits_count: 1,
      total_spent: 170,
      last_visit_at: '2026-09-09T15:31:04.000Z',
    },
    items: [
      {
        id: 1,
        order_id: 4,
        product_id: 101,
        product_name: '1L 7UP',
        product_sku: '7UP-1L',
        quantity: 1,
        unit_price: 170,
        subtotal: 170,
        tax_amount: 0,
        total: 170,
        addons: null,
        special_instructions: null,
        status: 'served',
      },
    ],
  };
}

export function createPizzaMafiaTestBill(): Bill {
  const order = createPizzaMafiaTestOrder();
  return {
    id: 4,
    bill_number: '4',
    order_id: 4,
    subtotal: 170,
    total: 170,
    tax_amount: 0,
    discount_amount: 0,
    service_charge: 0,
    delivery_charge: 0,
    paid_amount: 170,
    balance: 0,
    payment_status: 'paid',
    payment_details: [{ method: 'EasyPaisa', amount: 170, timestamp: '2026-09-09T15:31:04.000Z' }],
    order,
  };
}

/**
 * Multi-item test bill with long product names, modifiers/addons, and discounts
 */
export function createMultiItemTestBill(): Bill {
  const multiOrder: Order = {
    id: 18,
    order_number: '18',
    type: 'dine_in',
    status: 'completed',
    subtotal: 3120,
    discount_amount: 300,
    tax_amount: 150,
    delivery_charge: 0,
    table_id: null,
    customer_id: 12,
    guest_count: 2,
    special_instructions: null,
    created_by: 1,
    total: 2970,
    created_at: '2026-09-09T16:45:12.000Z',
    customer: {
      id: 12,
      name: 'Hassan Raza',
      phone: '03219876543',
      country_code: '+92',
      email: 'hassan@example.com',
      visits_count: 3,
      total_spent: 6500,
      last_visit_at: '2026-09-09T16:45:12.000Z',
    },
    items: [
      {
        id: 1,
        order_id: 18,
        product_id: 201,
        product_name: 'Chicken Tikka Supreme Large 16-inch Stuffed Crust',
        product_sku: 'TIKKA-LG',
        quantity: 1,
        unit_price: 1850,
        subtotal: 1850,
        tax_amount: 90,
        total: 1850,
        addons: [
          { id: 1, name: 'Extra Cheese', price: 200 },
          { id: 2, name: 'Dip Sauce', price: 70 },
        ],
        special_instructions: 'Well done crust, extra oregano',
        status: 'served',
      },
      {
        id: 2,
        order_id: 18,
        product_id: 202,
        product_name: 'Loaded Spicy Fries with Garlic Mayo',
        product_sku: 'FRIES-SP',
        quantity: 2,
        unit_price: 350,
        subtotal: 700,
        tax_amount: 40,
        total: 700,
        addons: null,
        special_instructions: null,
        status: 'served',
      },
      {
        id: 3,
        order_id: 18,
        product_id: 203,
        product_name: '1.5L Mountain Dew',
        product_sku: 'DEW-1.5L',
        quantity: 2,
        unit_price: 150,
        subtotal: 300,
        tax_amount: 20,
        total: 300,
        addons: null,
        special_instructions: null,
        status: 'served',
      },
    ],
  };

  return {
    id: 18,
    bill_number: '18',
    order_id: 18,
    subtotal: 3120,
    discount_amount: 300,
    tax_amount: 150,
    service_charge: 0,
    delivery_charge: 0,
    total: 2970,
    paid_amount: 2970,
    balance: 0,
    payment_status: 'paid',
    payment_details: [{ method: 'Cash', amount: 2970, timestamp: '2026-09-09T16:45:12.000Z' }],
    order: multiOrder,
  };
}
