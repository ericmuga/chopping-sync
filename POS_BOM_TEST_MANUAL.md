# POS BOM Production Test Manual

## Purpose
- Verify a POS flow that turns raw materials into a finished product using a predefined BOM.
- Confirm the system checks finished goods first, produces only when stock is insufficient, then consumes raw materials and checks out the finished item.

## Assumptions
- A BOM already exists for the finished item.
- Raw materials are stocked in inventory before testing.
- The POS can read available finished-goods stock before creating a production request.
- The POS can create a production request, issue raw materials, and receive the finished item back into stock.

## Business Rule
- Check existing finished goods first.
- If finished goods are enough, sell/checkout from stock and do not produce.
- If finished goods are not enough, create a production request for the shortfall.
- After production is completed, knock off raw-material stock.
- Add the finished item to stock.
- Then complete the checkout/sale of the finished item.

## Example Scenario
- Finished item: Hot dog
- BOM example:
  - 1 finished hot dog
  - 1 bun
  - 1 sausage
  - 1 condiment pack
- Goal: Sell 10 hot dogs.

## Test Data Setup
- Create BOM for the finished product.
- Load raw materials into inventory.
- Set finished-goods inventory to one of these states before each test:
  - 0 units
  - 5 units
  - 10 units
  - 15 units

## Test Steps
### 1. Finished Goods Available, Enough for Sale
- Set finished-goods stock to 10.
- Request sale of 10 hot dogs.
- Confirm the POS checks finished stock first.
- Confirm no production request is created.
- Confirm no raw materials are issued.
- Confirm 10 finished items are checked out.

### 2. Finished Goods Available, Not Enough for Sale
- Set finished-goods stock to 5.
- Request sale of 10 hot dogs.
- Confirm the POS checks finished stock first.
- Confirm a production request is created for 5 units.
- Confirm raw materials for 5 units are reserved or issued.
- Confirm production completes.
- Confirm raw materials are knocked off stock.
- Confirm 5 finished items are added to inventory.
- Confirm 10 finished items are checked out.

### 3. No Finished Goods Available
- Set finished-goods stock to 0.
- Request sale of 10 hot dogs.
- Confirm the POS checks finished stock first.
- Confirm a production request is created for 10 units.
- Confirm raw materials for 10 units are issued.
- Confirm production completes.
- Confirm finished goods are received into stock.
- Confirm 10 finished items are checked out.

### 4. Partial Production Failure
- Set finished-goods stock to 0.
- Request sale of 10 hot dogs.
- Fail production after raw materials are issued.
- Confirm the sale does not complete.
- Confirm raw-material issue is not duplicated.
- Confirm the system records the failure clearly.

### 5. Insufficient Raw Materials
- Set finished-goods stock to 0.
- Set raw materials lower than required for 10 units.
- Request sale of 10 hot dogs.
- Confirm the POS blocks production.
- Confirm the system shows which raw materials are short.
- Confirm no finished goods are created.
- Confirm no checkout occurs.

### 6. Overproduction Check
- Set finished-goods stock to 5.
- Request sale of 10 hot dogs.
- Confirm production request is created only for the shortage of 5 units.
- Confirm the system does not produce all 10 again.

### 7. Concurrent Sale Test
- Open two POS sessions.
- Request the same finished item at nearly the same time.
- Confirm stock is rechecked before checkout.
- Confirm production is not duplicated.
- Confirm inventory does not go negative.

## Expected Results
- Finished goods are always checked before production starts.
- Production happens only for missing quantity.
- Raw materials are consumed only after production is confirmed.
- Finished goods are increased only after production completes.
- Checkout completes only after stock is available.
- No duplicate production requests should be created for the same demand.

## Pass Criteria
- All steps complete without negative inventory.
- Finished goods and raw materials stay balanced.
- The sale is completed with the correct quantity.
- Audit/log messages show the decision path clearly.

## Fail Criteria
- Production starts when enough finished goods already exist.
- Raw materials are deducted twice.
- Finished goods are created without production completion.
- Checkout succeeds while stock is still insufficient.
- Inventory becomes negative.

## Notes For Testing
- Test one item at a time first.
- Then test multiple items in the same basket.
- Then test concurrent transactions.
- Then test error recovery after partial production.