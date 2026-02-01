import XCTest
@testable import Smithers

@MainActor
final class GraphLayoutTests: XCTestCase {
    var layoutEngine: GraphLayoutEngine!
    var graph: SessionGraph!

    override func setUp() {
        super.setUp()
        layoutEngine = GraphLayoutEngine()
        graph = SessionGraph()
    }

    override func tearDown() {
        layoutEngine = nil
        graph = nil
        super.tearDown()
    }

    // MARK: - Empty Graph Tests

    func testLayout_EmptyGraph_ReturnsEmptyResult() {
        let result = layoutEngine.layout(graph)

        XCTAssertTrue(result.nodes.isEmpty)
        XCTAssertTrue(result.edges.isEmpty)
        XCTAssertEqual(result.bounds.width, layoutEngine.config.padding * 2)
        XCTAssertEqual(result.bounds.height, layoutEngine.config.padding * 2)
    }

    // MARK: - Single Node Tests

    func testLayout_SingleNode_PositionsAtOriginWithPadding() {
        let node = GraphNode(
            id: UUID(),
            type: .message,
            parentId: nil,
            timestamp: Date(),
            data: ["text": AnyCodable("Hello")]
        )
        graph.addNode(node)

        let result = layoutEngine.layout(graph)

        XCTAssertEqual(result.nodes.count, 1)
        XCTAssertEqual(result.edges.count, 0)

        let layoutNode = result.nodes.first!
        XCTAssertEqual(layoutNode.position.x, layoutEngine.config.padding)
        XCTAssertEqual(layoutNode.position.y, layoutEngine.config.padding)
        XCTAssertEqual(layoutNode.size.width, layoutEngine.config.nodeWidth)
        XCTAssertEqual(layoutNode.size.height, layoutEngine.config.nodeHeight)
    }

    // MARK: - Linear Chain Tests

    func testLayout_TwoNodesLinearChain_PositionsVertically() {
        let root = GraphNode(
            id: UUID(),
            type: .message,
            parentId: nil,
            timestamp: Date(),
            data: ["text": AnyCodable("Root")]
        )
        graph.addNode(root)

        let child = GraphNode(
            id: UUID(),
            type: .message,
            parentId: root.id,
            timestamp: Date(),
            data: ["text": AnyCodable("Child")]
        )
        graph.addNode(child)

        let result = layoutEngine.layout(graph)

        XCTAssertEqual(result.nodes.count, 2)
        XCTAssertEqual(result.edges.count, 1)

        // Verify vertical stacking
        let rootLayout = result.node(for: root.id)!
        let childLayout = result.node(for: child.id)!

        XCTAssertLessThan(rootLayout.position.y, childLayout.position.y)
        XCTAssertEqual(
            childLayout.position.y - rootLayout.position.y,
            layoutEngine.config.nodeHeight + layoutEngine.config.verticalSpacing
        )

        // Verify horizontal alignment (same column)
        XCTAssertEqual(rootLayout.position.x, childLayout.position.x)
    }

    func testLayout_ThreeNodesLinearChain_CreatesThreeLayers() {
        let node1 = createNode(parentId: nil)
        let node2 = createNode(parentId: node1.id)
        let node3 = createNode(parentId: node2.id)

        graph.addNode(node1)
        graph.addNode(node2)
        graph.addNode(node3)

        let result = layoutEngine.layout(graph)

        XCTAssertEqual(result.nodes.count, 3)
        XCTAssertEqual(result.edges.count, 2)

        // Verify each node is in a different layer (Y coordinate increases)
        let layout1 = result.node(for: node1.id)!
        let layout2 = result.node(for: node2.id)!
        let layout3 = result.node(for: node3.id)!

        XCTAssertLessThan(layout1.position.y, layout2.position.y)
        XCTAssertLessThan(layout2.position.y, layout3.position.y)
    }

    // MARK: - Multiple Roots Tests

    func testLayout_TwoRoots_PositionsHorizontally() {
        let root1 = GraphNode(
            id: UUID(),
            type: .message,
            parentId: nil,
            timestamp: Date(),
            data: ["text": AnyCodable("Root 1")]
        )
        let root2 = GraphNode(
            id: UUID(),
            type: .message,
            parentId: nil,
            timestamp: Date(),
            data: ["text": AnyCodable("Root 2")]
        )

        graph.addNode(root1)
        graph.addNode(root2)

        let result = layoutEngine.layout(graph)

        XCTAssertEqual(result.nodes.count, 2)

        let layout1 = result.node(for: root1.id)!
        let layout2 = result.node(for: root2.id)!

        // Both roots should be on the same layer (Y coordinate)
        XCTAssertEqual(layout1.position.y, layout2.position.y)

        // Should be horizontally separated
        XCTAssertLessThan(layout1.position.x, layout2.position.x)
        XCTAssertEqual(
            layout2.position.x - layout1.position.x,
            layoutEngine.config.nodeWidth + layoutEngine.config.horizontalSpacing
        )
    }

    // MARK: - Tree Structure Tests

    func testLayout_OneRootTwoChildren_FormsTree() {
        let root = createNode(parentId: nil)
        let child1 = createNode(parentId: root.id)
        let child2 = createNode(parentId: root.id)

        graph.addNode(root)
        graph.addNode(child1)
        graph.addNode(child2)

        let result = layoutEngine.layout(graph)

        XCTAssertEqual(result.nodes.count, 3)
        XCTAssertEqual(result.edges.count, 2)

        let rootLayout = result.node(for: root.id)!
        let child1Layout = result.node(for: child1.id)!
        let child2Layout = result.node(for: child2.id)!

        // Root should be above children
        XCTAssertLessThan(rootLayout.position.y, child1Layout.position.y)
        XCTAssertLessThan(rootLayout.position.y, child2Layout.position.y)

        // Children should be on same layer
        XCTAssertEqual(child1Layout.position.y, child2Layout.position.y)

        // Children should be horizontally separated
        XCTAssertNotEqual(child1Layout.position.x, child2Layout.position.x)
    }

    func testLayout_ComplexTree_PositionsCorrectly() {
        // Build tree:
        //      root
        //     /    \
        //   c1      c2
        //  /  \      |
        // gc1 gc2   gc3

        let root = createNode(parentId: nil)
        let child1 = createNode(parentId: root.id)
        let child2 = createNode(parentId: root.id)
        let grandchild1 = createNode(parentId: child1.id)
        let grandchild2 = createNode(parentId: child1.id)
        let grandchild3 = createNode(parentId: child2.id)

        graph.addNode(root)
        graph.addNode(child1)
        graph.addNode(child2)
        graph.addNode(grandchild1)
        graph.addNode(grandchild2)
        graph.addNode(grandchild3)

        let result = layoutEngine.layout(graph)

        XCTAssertEqual(result.nodes.count, 6)
        XCTAssertEqual(result.edges.count, 5)

        // Verify layering
        let rootY = result.node(for: root.id)!.position.y
        let child1Y = result.node(for: child1.id)!.position.y
        let child2Y = result.node(for: child2.id)!.position.y
        let gc1Y = result.node(for: grandchild1.id)!.position.y
        let gc2Y = result.node(for: grandchild2.id)!.position.y
        let gc3Y = result.node(for: grandchild3.id)!.position.y

        // Root is topmost
        XCTAssertLessThan(rootY, child1Y)
        XCTAssertLessThan(rootY, child2Y)

        // Children are on same layer
        XCTAssertEqual(child1Y, child2Y)

        // Grandchildren are below children
        XCTAssertLessThan(child1Y, gc1Y)
        XCTAssertLessThan(child1Y, gc2Y)
        XCTAssertLessThan(child2Y, gc3Y)

        // All grandchildren on same layer
        XCTAssertEqual(gc1Y, gc2Y)
        XCTAssertEqual(gc2Y, gc3Y)
    }

    // MARK: - Edge Routing Tests

    func testLayout_Edge_HasBezierControlPoints() {
        let parent = createNode(parentId: nil)
        let child = createNode(parentId: parent.id)

        graph.addNode(parent)
        graph.addNode(child)

        let result = layoutEngine.layout(graph)

        XCTAssertEqual(result.edges.count, 1)
        let edge = result.edges.first!

        // Should have 4 points for cubic Bezier: start, control1, control2, end
        XCTAssertEqual(edge.points.count, 4)

        let parentLayout = result.node(for: parent.id)!
        let childLayout = result.node(for: child.id)!

        // First point should be at bottom-center of parent
        let expectedStart = CGPoint(
            x: parentLayout.center.x,
            y: parentLayout.position.y + parentLayout.size.height
        )
        XCTAssertEqual(edge.points[0], expectedStart)

        // Last point should be at top-center of child
        let expectedEnd = CGPoint(
            x: childLayout.center.x,
            y: childLayout.position.y
        )
        XCTAssertEqual(edge.points[3], expectedEnd)

        // Control points should be between start and end vertically
        XCTAssertGreaterThan(edge.points[1].y, expectedStart.y)
        XCTAssertLessThan(edge.points[2].y, expectedEnd.y)
    }

    // MARK: - Bounds Calculation Tests

    func testLayout_Bounds_EnclosesAllNodes() {
        let root = createNode(parentId: nil)
        let child1 = createNode(parentId: root.id)
        let child2 = createNode(parentId: root.id)

        graph.addNode(root)
        graph.addNode(child1)
        graph.addNode(child2)

        let result = layoutEngine.layout(graph)

        // Verify all nodes are within bounds
        for layoutNode in result.nodes {
            let nodeRect = layoutNode.bounds
            XCTAssertLessThanOrEqual(nodeRect.minX, result.bounds.maxX)
            XCTAssertLessThanOrEqual(nodeRect.minY, result.bounds.maxY)
            XCTAssertGreaterThanOrEqual(nodeRect.maxX, result.bounds.minX)
            XCTAssertGreaterThanOrEqual(nodeRect.maxY, result.bounds.minY)
        }

        // Bounds should include padding
        XCTAssertGreaterThan(result.bounds.width, layoutEngine.config.nodeWidth)
        XCTAssertGreaterThan(result.bounds.height, layoutEngine.config.nodeHeight)
    }

    // MARK: - Node Types Tests

    func testLayout_MixedNodeTypes_AllLayoutCorrectly() {
        let message = GraphNode(
            id: UUID(),
            type: .message,
            parentId: nil,
            timestamp: Date(),
            data: ["text": AnyCodable("Message")]
        )
        let toolUse = GraphNode(
            id: UUID(),
            type: .toolUse,
            parentId: message.id,
            timestamp: Date(),
            data: ["tool_name": AnyCodable("bash")]
        )
        let toolResult = GraphNode(
            id: UUID(),
            type: .toolResult,
            parentId: toolUse.id,
            timestamp: Date(),
            data: ["success": AnyCodable(true)]
        )
        let checkpoint = GraphNode(
            id: UUID(),
            type: .checkpoint,
            parentId: toolResult.id,
            timestamp: Date(),
            data: ["label": AnyCodable("checkpoint-1")]
        )

        graph.addNode(message)
        graph.addNode(toolUse)
        graph.addNode(toolResult)
        graph.addNode(checkpoint)

        let result = layoutEngine.layout(graph)

        XCTAssertEqual(result.nodes.count, 4)
        XCTAssertEqual(result.edges.count, 3)

        // All nodes should have valid positions
        for layoutNode in result.nodes {
            XCTAssertGreaterThanOrEqual(layoutNode.position.x, 0)
            XCTAssertGreaterThanOrEqual(layoutNode.position.y, 0)
            XCTAssertEqual(layoutNode.size.width, layoutEngine.config.nodeWidth)
            XCTAssertEqual(layoutNode.size.height, layoutEngine.config.nodeHeight)
        }
    }

    // MARK: - Determinism Tests

    func testLayout_Determinism_SameGraphSameLayout() {
        // Create a graph
        let root = createNode(parentId: nil)
        let child1 = createNode(parentId: root.id)
        let child2 = createNode(parentId: root.id)

        graph.addNode(root)
        graph.addNode(child1)
        graph.addNode(child2)

        // Layout multiple times
        let result1 = layoutEngine.layout(graph)
        let result2 = layoutEngine.layout(graph)
        let result3 = layoutEngine.layout(graph)

        // All results should be identical
        XCTAssertEqual(result1.nodes.count, result2.nodes.count)
        XCTAssertEqual(result2.nodes.count, result3.nodes.count)

        for (node1, node2, node3) in zip(result1.nodes, result2.nodes, result3.nodes) {
            XCTAssertEqual(node1.id, node2.id)
            XCTAssertEqual(node2.id, node3.id)
            XCTAssertEqual(node1.position, node2.position)
            XCTAssertEqual(node2.position, node3.position)
        }
    }

    func testLayout_DifferentGraphs_DifferentLayouts() {
        // Create first graph
        let graph1 = SessionGraph()
        let root1 = createNode(parentId: nil)
        graph1.addNode(root1)

        // Create second graph with more nodes
        let graph2 = SessionGraph()
        let root2 = createNode(parentId: nil)
        let child2 = createNode(parentId: root2.id)
        graph2.addNode(root2)
        graph2.addNode(child2)

        let result1 = layoutEngine.layout(graph1)
        let result2 = layoutEngine.layout(graph2)

        XCTAssertNotEqual(result1.nodes.count, result2.nodes.count)
        XCTAssertNotEqual(result1.bounds, result2.bounds)
    }

    // MARK: - Custom Configuration Tests

    func testLayout_CustomConfig_AppliesSpacing() {
        let customConfig = GraphLayoutEngine.Config(
            nodeWidth: 150,
            nodeHeight: 80,
            horizontalSpacing: 100,
            verticalSpacing: 120,
            padding: 60
        )
        let customEngine = GraphLayoutEngine(config: customConfig)

        let root = createNode(parentId: nil)
        let child = createNode(parentId: root.id)

        graph.addNode(root)
        graph.addNode(child)

        let result = customEngine.layout(graph)

        let rootLayout = result.node(for: root.id)!
        let childLayout = result.node(for: child.id)!

        // Verify custom sizes applied
        XCTAssertEqual(rootLayout.size.width, customConfig.nodeWidth)
        XCTAssertEqual(rootLayout.size.height, customConfig.nodeHeight)

        // Verify custom spacing applied
        XCTAssertEqual(
            childLayout.position.y - rootLayout.position.y,
            customConfig.nodeHeight + customConfig.verticalSpacing
        )

        // Verify custom padding applied
        XCTAssertEqual(rootLayout.position.x, customConfig.padding)
        XCTAssertEqual(rootLayout.position.y, customConfig.padding)
    }

    // MARK: - Helper Methods

    private func createNode(parentId: UUID?) -> GraphNode {
        GraphNode(
            id: UUID(),
            type: .message,
            parentId: parentId,
            timestamp: Date(),
            data: ["text": AnyCodable("Node")]
        )
    }
}

// MARK: - Layout Node Tests

@MainActor
final class LayoutNodeTests: XCTestCase {
    func testBounds_CalculatesCorrectly() {
        let node = LayoutNode(
            id: UUID(),
            position: CGPoint(x: 10, y: 20),
            size: CGSize(width: 100, height: 50)
        )

        XCTAssertEqual(node.bounds.origin, CGPoint(x: 10, y: 20))
        XCTAssertEqual(node.bounds.size, CGSize(width: 100, height: 50))
        XCTAssertEqual(node.bounds.minX, 10)
        XCTAssertEqual(node.bounds.minY, 20)
        XCTAssertEqual(node.bounds.maxX, 110)
        XCTAssertEqual(node.bounds.maxY, 70)
    }

    func testCenter_CalculatesCorrectly() {
        let node = LayoutNode(
            id: UUID(),
            position: CGPoint(x: 10, y: 20),
            size: CGSize(width: 100, height: 50)
        )

        XCTAssertEqual(node.center, CGPoint(x: 60, y: 45))
    }
}

// MARK: - Graph Layout Result Tests

@MainActor
final class GraphLayoutResultTests: XCTestCase {
    func testNodeLookup_FindsNodeById() {
        let id1 = UUID()
        let id2 = UUID()

        let node1 = LayoutNode(id: id1, position: .zero, size: .zero)
        let node2 = LayoutNode(id: id2, position: .zero, size: .zero)

        let result = GraphLayoutResult(
            nodes: [node1, node2],
            edges: [],
            bounds: .zero
        )

        XCTAssertEqual(result.node(for: id1)?.id, id1)
        XCTAssertEqual(result.node(for: id2)?.id, id2)
        XCTAssertNil(result.node(for: UUID()))
    }
}
